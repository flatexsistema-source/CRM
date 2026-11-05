// Stripe avisa aqui: pagamento confirmado -> gera PIN e envia por e-mail; atraso -> começa a contar 15 dias
const { rest, res, site, marca, novoPin, hashPin, mail, wrap, crypto } = require('./lib/util');

function assinaturaValida(raw, header, segredo) {
  if (!header || !segredo) return false;
  const partes = header.split(',').map(s => s.split('='));
  const t = (partes.find(p => p[0] === 't') || [])[1];
  const v1 = partes.filter(p => p[0] === 'v1').map(p => p[1]);
  if (!t || !v1.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const esperado = crypto.createHmac('sha256', segredo).update(t + '.' + raw).digest('hex');
  return v1.some(x => x.length === esperado.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(esperado)));
}

exports.handler = async (event) => {
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (!assinaturaValida(raw, event.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) return res(400, { err: 'assinatura inválida' });

  try {
    const ev = JSON.parse(raw);
    const o = ev.data.object;
    const hoje = new Date().toISOString().slice(0, 10);

    if (ev.type === 'checkout.session.completed' && o.mode === 'subscription') {
      const id = o.client_reference_id;
      const e = id && (await rest('empresas?id=eq.' + id + '&select=*'))[0];
      if (e && e.status === 'aguardando_pagamento') {
        const pin = novoPin();
        await rest('empresas?id=eq.' + id, 'PATCH', {
          status: 'aguardando_pin', stripe_customer: o.customer, stripe_subscription: o.subscription,
          vencido_desde: null, pin_hash: hashPin(pin), pin_tentativas: 0
        });
        const para = e.email || (o.customer_details && o.customer_details.email);
        await mail(para, 'Seu PIN de ativação — ' + marca(), wrap('Pagamento confirmado!',
          `<p>Seu PIN de ativação é:</p>
           <p style="font-size:30px;letter-spacing:4px;font-weight:bold;background:#eef6f7;padding:14px;text-align:center;border-radius:8px">${pin}</p>
           <p>Abra <a href="${site()}/ativar.html?email=${encodeURIComponent(para)}">${site()}/ativar.html</a>, digite o PIN e crie a sua senha.
           Depois é só entrar no sistema — o espaço da sua empresa já estará pronto, vazio e só seu.</p>`));
      }
    }

    if (ev.type === 'invoice.payment_failed') {
      const e = (await rest('empresas?stripe_customer=eq.' + o.customer + '&select=id,vencido_desde'))[0];
      if (e && !e.vencido_desde) await rest('empresas?id=eq.' + e.id, 'PATCH', { vencido_desde: hoje });
    }

    if (ev.type === 'invoice.paid') {
      const e = (await rest('empresas?stripe_customer=eq.' + o.customer + '&select=id,status'))[0];
      if (e) await rest('empresas?id=eq.' + e.id, 'PATCH', { vencido_desde: null, ...(e.status === 'bloqueada' ? { status: 'ativa' } : {}) });
    }

    if (ev.type === 'customer.subscription.deleted') {
      await rest('empresas?stripe_customer=eq.' + o.customer, 'PATCH', { status: 'cancelada' });
    }
    return res(200, { ok: 1 });
  } catch (e) {
    return res(500, { err: 'erro' });
  }
};
