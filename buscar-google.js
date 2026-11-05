// Gestor busca empresas no Google Maps (Places API oficial) e importa como leads, sem repetir telefones
const { rest, quem, res } = require('./lib/util');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { err: 'Método inválido.' });
  try {
    const me = await quem(event);
    if (!me || me.role === 'vendedor') return res(403, { err: 'Só o gestor pode captar clientes.' });
    if (!process.env.GOOGLE_PLACES_KEY) return res(400, { err: 'A busca no Google Maps ainda não foi ativada pelo desenvolvedor.' });
    const emp = (await rest('empresas?id=eq.' + me.empresa_id + '&select=status'))[0];
    if (!emp || (emp.status !== 'ativa' && me.role !== 'dev')) return res(403, { err: 'Assinatura inativa.' });

    const b = JSON.parse(event.body || '{}');
    const consulta = String(b.consulta || '').trim().slice(0, 80), cidade = String(b.cidade || '').trim().slice(0, 80);
    const alvo = Math.max(1, Math.min(parseInt(b.quantidade) || 20, 60));
    if (!consulta || !cidade) return res(400, { err: 'Informe o ramo e a cidade.' });

    const achados = [];
    let token;
    for (let p = 0; p < 3 && achados.length < alvo; p++) {
      const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_PLACES_KEY,
          'X-Goog-FieldMask': 'places.displayName,places.nationalPhoneNumber,places.websiteUri,nextPageToken'
        },
        body: JSON.stringify({ textQuery: consulta + ' em ' + cidade, languageCode: 'pt-BR', regionCode: 'BR', pageSize: 20, ...(token ? { pageToken: token } : {}) })
      });
      const j = await r.json();
      if (!r.ok) return res(502, { err: 'O Google recusou a busca. Confira a chave e o faturamento da conta Google Maps.' });
      for (const x of (j.places || [])) {
        const fone = String(x.nationalPhoneNumber || '').replace(/\D/g, '');
        if (fone.length >= 10 && achados.length < alvo) achados.push({ nome: (x.displayName && x.displayName.text) || '', fone, site: x.websiteUri || '' });
      }
      token = j.nextPageToken;
      if (!token) break;
    }

    const existentes = await rest('rec?empresa_id=eq.' + me.empresa_id + '&kind=in.(leads,clientes)&select=data');
    const tem = new Set((existentes || []).map(r => String(r.data.fone || '').replace(/\D/g, '').slice(-8)).filter(Boolean));
    const cid = cidade.replace(/[\s,-]+[A-Za-z]{2}$/, '').trim();
    const agora = new Date().toLocaleString('sv', { timeZone: 'America/Sao_Paulo' });
    const novos = [];
    for (const a of achados) {
      const k = a.fone.slice(-8);
      if (!a.nome || tem.has(k)) continue;
      tem.add(k);
      novos.push({ empresa_id: me.empresa_id, kind: 'leads', data: {
        empresa: a.nome, cidade: cid, fone: a.fone, contato: '', canal: 'Google Maps', status: 'Abordar', fase: 'prospeccao',
        potencial: 0, retorno: '', obs: a.site, dono: '', data: agora.slice(0, 10), em: agora.slice(0, 16).replace(' ', 'T'), por: 'Captação' } });
    }
    if (novos.length) await rest('rec', 'POST', novos);
    return res(200, { encontrados: achados.length, novos: novos.length, duplicados: achados.length - novos.length });
  } catch (e) {
    return res(500, { err: 'Erro na busca. Tente de novo em instantes.' });
  }
};
