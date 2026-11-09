// Busca GRÁTIS de empresas no OpenStreetMap (dados abertos) e importa como leads
const { quem, res, rest, salvarLeads } = require('./lib/util');

const RAMOS = [
  [/lava|lavagem|jato/i, ['amenity=car_wash']], [/est[eé]tica|detail|polimento/i, ['amenity=car_wash', 'shop=car_repair']],
  [/oficina|mec[aâ]nica|funilaria/i, ['shop=car_repair']], [/auto ?pe[cç]a/i, ['shop=car_parts']], [/pneu/i, ['shop=tyres']],
  [/concession|ve[ií]culo|carros?\b/i, ['shop=car']], [/tinta/i, ['shop=paint']], [/academia/i, ['leisure=fitness_centre']],
  [/restaurante/i, ['amenity=restaurant']], [/mercado|supermercado/i, ['shop=supermarket']], [/padaria/i, ['shop=bakery']],
  [/farm[aá]cia/i, ['amenity=pharmacy']], [/sal[aã]o|cabelei/i, ['shop=hairdresser']], [/material de constru/i, ['shop=doityourself']]
];
const UA = { 'User-Agent': 'Prospera-CRM/1.0 (captacao de leads)', 'Accept-Language': 'pt-BR' };
const limpa = t => { let d = String(t || '').split(/[;,\/]/)[0].replace(/\D/g, ''); if (d.startsWith('55') && d.length > 11) d = d.slice(2); return d; };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { err: 'Método inválido.' });
  try {
    const me = await quem(event);
    if (!me || me.role === 'vendedor') return res(403, { err: 'Só o gestor pode captar clientes.' });
    const b = JSON.parse(event.body || '{}');
    const consulta = String(b.consulta || '').trim().slice(0, 80), cidade = String(b.cidade || '').trim().slice(0, 80);
    if (!consulta || !cidade) return res(400, { err: 'Informe o ramo e a cidade.' });
    const alvo = Math.max(1, Math.min(parseInt(b.quantidade) || 20, 200));
    const tags = (RAMOS.find(r => r[0].test(consulta)) || [])[1];
    if (!tags) return res(400, { err: 'Ramo não reconhecido na busca grátis. Tente: lava rápido, estética automotiva, oficina, autopeças, pneus, concessionária, tintas, academia, restaurante, mercado, padaria, farmácia ou salão. Para outros ramos use a busca do Google.' });

    const n = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=' + encodeURIComponent(cidade + ', Brasil'), { headers: UA });
    const loc = (await n.json())[0];
    if (!loc || loc.osm_type !== 'relation') return res(400, { err: 'Não encontrei essa cidade. Escreva assim: Americana SP.' });
    const area = 3600000000 + Number(loc.osm_id);

    const q = '[out:json][timeout:8];area(' + area + ')->.a;(' + tags.map(t => { const [k, v] = t.split('='); return 'nwr["' + k + '"="' + v + '"](area.a);'; }).join('') + ');out tags 400;';
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 9000);
    let j;
    try {
      const o = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: ctl.signal });
      j = await o.json();
    } catch (e) { return res(504, { err: 'O OpenStreetMap demorou a responder. Tente de novo em 1 minuto.' }); } finally { clearTimeout(timer); }

    const achados = [];
    for (const el of (j.elements || [])) {
      const t = el.tags || {}, fone = limpa(t.phone || t['contact:phone'] || t.mobile || t['contact:mobile'] || t['contact:whatsapp']);
      if (t.name && fone.length >= 10 && fone.length <= 11 && achados.length < alvo) achados.push({ nome: t.name, fone, site: t.website || t['contact:website'] || '' });
    }
    const cid = cidade.replace(/[\s,-]+[A-Za-z]{2}$/, '').trim();
    const novos = await salvarLeads(me.empresa_id, achados, 'OpenStreetMap', cid);
    return res(200, { encontrados: achados.length, novos, duplicados: achados.length - novos });
  } catch (e) {
    return res(500, { err: 'Erro na busca. Tente de novo em instantes.' });
  }
};
