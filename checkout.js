// Cliente informa o e-mail + plano -> cria o pagamento recorrente (Stripe) e envia o link por e-mail
const { rest, res, site, marca, mail, wrap } = require('./lib/util');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { err: 'Método inválido.' });
  try {
    const { plano_id, email } = JSON.parse(event.body || '{}');
    const em = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return res(400, { err: 'Digite um e-mail válido.' });

    const pl = await rest('planos?id=eq.' + Number(plano_id) + '&ativo=eq.true&select=*');
    if (!pl || !pl[0]) return res(400, { err: 'Plano indisponível.' });
    const p = pl[0];

    const emp = (await rest('empresas', 'POST', { email: em, plano_id: p.id, status: 'aguardando_pagamento' }))[0];

    const f = new URLSearchParams({
      mode: 'subscription',
      customer_email: em,
      client_reference_id: emp.id,
      locale: 'pt-BR',
      success_url: site() + '/ativar.html?pago=1&email=' + encodeURIComponent(em),
      cancel_url: site() + '/#planos',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'brl',
      'line_items[0][price_data][unit_amount]': String(p.preco_centavos),
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][product_data][name]': marca() + ' — assinatura mensal, plano ' + p.nome,
      'subscription_data[metadata][empresa_id]': emp.id
    });
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: f
    });
    const s = await r.json();
    if (!r.ok || !s.url) return res(502, { err: 'Não foi possível abrir o pagamento agora. Tente de novo ou fale pelo WhatsApp.' });

    mail(em, 'Seu link de pagamento — ' + marca(), wrap('Falta só o pagamento',
      `<p>Você escolheu o plano <b>${p.nome}</b>. Para continuar, use o link seguro abaixo:</p>
       <p><a href="${s.url}" style="background:#0a8ea0;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block">Pagar e ativar</a></p>
       <p>Assim que o pagamento for confirmado, enviaremos o <b>PIN de ativação</b> para este e-mail.</p>`)).catch(() => {});

    return res(200, { url: s.url });
  } catch (e) {
    return res(500, { err: 'Erro ao iniciar a assinatura.' });
  }
};
