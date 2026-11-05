// Recebe leads de fora (site, Linktree, anúncios, ManyChat, Zapier, Make) e coloca na tela de todos, na hora
const { rest } = require('./lib/util');
const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Content-Type': 'application/json' };
const out = (c, o, extra = {}) => ({ statusCode: c, headers: { ...H, ...extra }, body: JSON.stringify(o) });
const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: H, body: '' };
  try {
    let b = {};
    const raw = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : '';
    if (raw) b = (event.headers['content-type'] || '').includes('json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
    b = { ...(event.queryStringParameters || {}), ...b };

    const token = String(b.token || '').replace(/[^a-zA-Z0-9]/g, '');
    if (token.length < 20) return out(403, { err: 'token inválido' });
    const cfg = await rest('rec?kind=eq.cfg&data->>token_leads=eq.' + token + '&select=empresa_id&limit=1');
    if (!cfg || !cfg[0]) return out(403, { err: 'token inválido' });
    const emp = cfg[0].empresa_id;

    const e = (await rest('empresas?id=eq.' + emp + '&select=status,vencido_desde'))[0];
    const atraso = e && e.vencido_desde && (Date.now() - new Date(e.vencido_desde).getTime()) / 864e5 > 15;
    if (!e || e.status !== 'ativa' || atraso) return out(403, { err: 'conta inativa' });

    const fone = String(b.telefone || b.fone || b.phone || b.whatsapp || '').replace(/\D/g, '').slice(0, 15);
    const nome = txt(b.empresa || b.nome || b.name, 120);
    if (!nome && !fone) return out(400, { err: 'informe nome ou telefone' });

    let dup = false;
    if (fone.length >= 8) {
      const d = await rest('rec?kind=eq.leads&empresa_id=eq.' + emp + '&data->>fone=like.*' + fone.slice(-8) + '&select=id&limit=1');
      dup = !!(d && d[0]);
    }
    if (!dup) {
      const agora = new Date().toLocaleString('sv', { timeZone: 'America/Sao_Paulo' });
      await rest('rec', 'POST', {
        empresa_id: emp, kind: 'leads',
        data: {
          empresa: nome || ('Contato ' + fone), contato: txt(b.contato || b.nome || b.name, 80), fone, email: txt(b.email, 120),
          cidade: txt(b.cidade || b.city, 80), canal: txt(b.canal || b.origem || b.source, 40) || 'Site',
          status: 'Abordar', fase: 'prospeccao', potencial: 0, retorno: '', obs: txt(b.mensagem || b.obs || b.message, 500),
          dono: '', data: agora.slice(0, 10), externo: true, em: agora.slice(0, 16).replace(' ', 'T'), por: 'Captação'
        }
      });
    }
    if (b.redirect && /^https?:\/\//.test(b.redirect)) return { statusCode: 303, headers: { ...H, Location: b.redirect }, body: '' };
    return out(200, { ok: 1, duplicado: dup });
  } catch (x) {
    return out(500, { err: 'erro ao receber o lead' });
  }
};
