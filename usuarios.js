// Gestor cria / edita / exclui usuários da própria empresa, respeitando o limite do plano
const { rest, admin, quem, res } = require('./lib/util');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { err: 'Método inválido.' });
  try {
    const me = await quem(event);
    if (!me || me.role === 'vendedor') return res(403, { err: 'Só o gestor pode fazer isso.' });
    const b = JSON.parse(event.body || '{}');
    const emp = (await rest('empresas?id=eq.' + me.empresa_id + '&select=*,planos(max_usuarios)'))[0];
    if (!emp || (emp.status !== 'ativa' && me.role !== 'dev')) return res(403, { err: 'Assinatura inativa.' });

    const buscar = id => rest('rec?id=eq.' + Number(id) + '&empresa_id=eq.' + me.empresa_id + '&kind=eq.users&select=*').then(r => r && r[0]);

    if (b.acao === 'excluir') {
      const cur = await buscar(b.id);
      if (!cur) return res(404, { err: 'Usuário não encontrado.' });
      if (cur.data.auth_id === me.uid) return res(400, { err: 'Você não pode excluir o seu próprio usuário.' });
      if (cur.data.auth_id) await admin('users/' + cur.data.auth_id, 'DELETE');
      await rest('rec?id=eq.' + cur.id, 'DELETE');
      return res(200, { ok: 1 });
    }

    if (b.acao === 'salvar') {
      const d = { ...b }; delete d.acao;
      const senha = String(d.senha || ''); delete d.senha;
      const email = String(d.login || '').trim().toLowerCase();
      const nome = String(d.nome || '').trim();
      const role = d.perfil === 'Gestor' ? 'admin' : 'vendedor';
      if (!nome || !email) return res(400, { err: 'Preencha o nome e o e-mail.' });
      if (senha && senha.length < 8) return res(400, { err: 'A senha precisa ter 8 caracteres ou mais.' });

      if (d.id) {
        const cur = await buscar(d.id);
        if (!cur) return res(404, { err: 'Usuário não encontrado.' });
        if (cur.data.auth_id === me.uid && role !== 'admin' && me.role !== 'dev') return res(400, { err: 'Você não pode tirar o seu próprio acesso de gestor.' });
        const upd = {};
        if (senha) upd.password = senha;
        if (email !== cur.data.login) { upd.email = email; upd.email_confirm = true; }
        if (Object.keys(upd).length && cur.data.auth_id) {
          try { await admin('users/' + cur.data.auth_id, 'PUT', upd); }
          catch (x) { return res(400, { err: x.status === 422 ? 'Este e-mail já está em uso.' : 'Não foi possível atualizar o acesso.' }); }
        }
        if (cur.data.auth_id) await rest('perfis?user_id=eq.' + cur.data.auth_id, 'PATCH', { nome, email, role: me.role === 'dev' && cur.data.auth_id === me.uid ? 'dev' : role });
        const data = { ...cur.data, ...d, login: email, nome }; delete data.id;
        const out = await rest('rec?id=eq.' + cur.id, 'PATCH', { data });
        return res(200, { rec: { ...out[0].data, id: out[0].id } });
      }

      const max = emp.planos && emp.planos.max_usuarios;
      if (max) {
        const n = (await rest('perfis?empresa_id=eq.' + me.empresa_id + '&select=user_id')).length;
        if (n >= max) return res(403, { err: 'Seu plano permite até ' + max + ' usuários. Fale com o suporte para mudar de plano.' });
      }
      if (!senha) return res(400, { err: 'Defina uma senha com 8 caracteres ou mais.' });
      let u;
      try { u = await admin('users', 'POST', { email, password: senha, email_confirm: true }); }
      catch (x) { return res(400, { err: x.status === 422 ? 'Já existe um usuário com este e-mail.' : 'Não foi possível criar o usuário.' }); }
      await rest('perfis', 'POST', { user_id: u.id, empresa_id: me.empresa_id, nome, email, role });
      const data = { ...d, login: email, nome, auth_id: u.id }; delete data.id;
      const out = await rest('rec', 'POST', { empresa_id: me.empresa_id, kind: 'users', data });
      return res(200, { rec: { ...out[0].data, id: out[0].id } });
    }
    return res(400, { err: 'Ação inválida.' });
  } catch (e) {
    return res(500, { err: 'Erro ao salvar o usuário.' });
  }
};
