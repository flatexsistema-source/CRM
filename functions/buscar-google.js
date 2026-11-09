// Gestor busca empresas no Google Maps (Places API oficial) e importa como leads, sem repetir telefones
const { rest, quem, res, salvarLeads } = require('./lib/util');

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

    // trava de segurança: fica dentro da cota gratuita do Google (1.000 chamadas/mês no SKU com telefone)
    const mes = new Date().toISOString().slice(0, 7).replace('-', ''), chave = 'gp_' + mes, limite = parseInt(process.env.GOOGLE_LIMITE || '900');
    const uso = parseInt(((await rest('config?chave=eq.' + chave + '&select=valor'))[0] || {}).valor || '0');
    if (uso + 3 > limite) return res(429, { err: 'O limite gratuito de buscas no Google deste mês foi atingido. Use a busca grátis (OpenStreetMap) ou espere o mês virar.' });
    let chamadas = 0;
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
      chamadas++;
      const j = await r.json();
      if (!r.ok) return res(502, { err: 'O Google recusou a busca: ' + ((j.error && j.error.message) || ('erro ' + r.status)).slice(0, 220) });
      for (const x of (j.places || [])) {
        const fone = String(x.nationalPhoneNumber || '').replace(/\D/g, '');
        if (fone.length >= 10 && achados.length < alvo) achados.push({ nome: (x.displayName && x.displayName.text) || '', fone, site: x.websiteUri || '' });
      }
      token = j.nextPageToken;
      if (!token) break;
    }

    await rest('config', 'POST', { chave, valor: String(uso + chamadas) }, 'resolution=merge-duplicates,return=representation');
    const cid = cidade.replace(/[\s,-]+[A-Za-z]{2}$/, '').trim();
    const novos = await salvarLeads(me.empresa_id, achados, 'Google Maps', cid);
    return res(200, { encontrados: achados.length, novos, duplicados: achados.length - novos });
  } catch (e) {
    return res(500, { err: 'Erro na busca. Tente de novo em instantes.' });
  }
};
