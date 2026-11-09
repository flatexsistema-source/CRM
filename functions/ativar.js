// Cliente digita e-mail + PIN + senha -> cria o login e o espaço (banco) próprio da empresa dele
const { rest, admin, res, hashPin, crypto } = require('./lib/util');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { err: 'Método inválido.' });
  try {
    const b = JSON.parse(event.body || '{}');
    const email = String(b.email || '').trim().toLowerCase();
    const senha = String(b.senha || '');
    const nome = String(b.nome_empresa || '').trim();
    if (!email || !b.pin) return res(400, { err: 'Informe o e-mail e o PIN.' });
    if (senha.length < 8) return res(400, { err: 'A senha precisa ter 8 caracteres ou mais.' });
    if (!nome) return res(400, { err: 'Digite o nome da sua empresa.' });

    const lista = await rest('empresas?email=ilike.' + encodeURIComponent(email) + '&status=eq.aguardando_pin&order=criado_em.desc&limit=1&select=*');
    const e = lista && lista[0];
    const erro = { err: 'PIN ou e-mail incorreto.' };
    if (!e) return res(400, erro);
    if (e.pin_tentativas >= 8) return res(429, { err: 'Muitas tentativas. Fale com o suporte para receber um novo PIN.' });

    const a = Buffer.from(hashPin(b.pin)), c = Buffer.from(e.pin_hash || '');
    if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) {
      await rest('empresas?id=eq.' + e.id, 'PATCH', { pin_tentativas: e.pin_tentativas + 1 });
      return res(400, erro);
    }

    let u;
    try { u = await admin('users', 'POST', { email, password: senha, email_confirm: true }); }
    catch (x) { return res(400, { err: x.status === 422 ? 'Já existe uma conta com este e-mail. Entre pelo sistema ou fale com o suporte.' : 'Não foi possível criar a conta.' }); }

    await rest('perfis', 'POST', { user_id: u.id, empresa_id: e.id, nome: nome, email, role: 'admin' });
    await rest('rec', 'POST', [
      { empresa_id: e.id, kind: 'users', data: { nome: 'Gestor', login: email, perfil: 'Gestor', auth_id: u.id } },
      { empresa_id: e.id, kind: 'cfg', data: { empresa: nome, email } }
    ]);
    await rest('empresas?id=eq.' + e.id, 'PATCH', { status: 'ativa', nome, pin_hash: null, ativada_em: new Date().toISOString() });
    return res(200, { ok: 1 });
  } catch (e) {
    return res(500, { err: 'Erro ao ativar. Tente novamente ou fale com o suporte.' });
  }
};
