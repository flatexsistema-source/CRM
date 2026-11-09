const crypto = require('crypto');
const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

const hdr = (extra = {}) => ({ apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', ...extra });
const res = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
const site = () => (process.env.SITE_URL || process.env.URL || '').replace(/\/$/, '');
const marca = () => process.env.MARCA || 'CRM';

async function rest(path, method = 'GET', body, prefer = 'return=representation') {
  const r = await fetch(SB + '/rest/v1/' + path, {
    method, headers: hdr({ Prefer: prefer }),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text();
  if (!r.ok) throw new Error('db: ' + t);
  return t ? JSON.parse(t) : null;
}

async function admin(path, method, body) {
  const r = await fetch(SB + '/auth/v1/admin/' + path, {
    method, headers: hdr(), body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text();
  const j = t ? JSON.parse(t) : {};
  if (!r.ok) throw Object.assign(new Error(j.msg || j.message || j.error_description || t), { status: r.status });
  return j;
}

// confere quem está logado (token do Supabase) e devolve o perfil dele
async function quem(event) {
  const tk = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /i, '');
  if (!tk) return null;
  const r = await fetch(SB + '/auth/v1/user', { headers: { apikey: KEY, Authorization: 'Bearer ' + tk } });
  if (!r.ok) return null;
  const u = await r.json();
  const p = await rest('perfis?user_id=eq.' + u.id + '&select=*');
  return p && p[0] ? { ...p[0], uid: u.id } : null;
}

function novoPin() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const s = Array.from(crypto.randomBytes(8), b => a[b % a.length]).join('');
  return s.slice(0, 4) + '-' + s.slice(4);
}
const limpaPin = p => String(p || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const hashPin = p => crypto.createHash('sha256').update(limpaPin(p)).digest('hex');

async function mail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || 'onboarding@resend.dev', to: [to], subject, html })
  });
  return r.ok;
}

const wrap = (titulo, corpo) => `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0d2b33">
<h2 style="margin:0 0 12px">${titulo}</h2>${corpo}
<p style="color:#6b8288;font-size:12px;margin-top:28px">${marca()} · ${process.env.DESENVOLVEDOR || ''}</p></div>`;

// grava uma lista de empresas como leads, sem repetir telefones que a empresa já tem (leads e clientes)
async function salvarLeads(empId, lista, canal, cidade) {
  const ex = await rest('rec?empresa_id=eq.' + empId + '&kind=in.(leads,clientes)&select=data');
  const tem = new Set((ex || []).map(r => String(r.data.fone || '').replace(/\D/g, '').slice(-8)).filter(Boolean));
  const agora = new Date().toLocaleString('sv', { timeZone: 'America/Sao_Paulo' });
  const novos = [];
  for (const a of lista) {
    const k = a.fone.slice(-8);
    if (!a.nome || tem.has(k)) continue;
    tem.add(k);
    novos.push({ empresa_id: empId, kind: 'leads', data: {
      empresa: a.nome, cidade, fone: a.fone, contato: '', canal, status: 'Abordar', fase: 'prospeccao', potencial: 0, retorno: '',
      obs: a.site || '', dono: '', data: agora.slice(0, 10), em: agora.slice(0, 16).replace(' ', 'T'), por: 'Captação' } });
  }
  if (novos.length) await rest('rec', 'POST', novos);
  return novos.length;
}

module.exports = { salvarLeads, rest, admin, quem, res, site, marca, novoPin, limpaPin, hashPin, mail, wrap, crypto };
