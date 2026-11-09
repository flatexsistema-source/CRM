// Abre o painel de pagamento do Stripe (trocar cartão, ver faturas, cancelar)
const { rest, quem, res, site } = require('./lib/util');

exports.handler = async (event) => {
  try {
    const me = await quem(event);
    if (!me || me.role === 'vendedor') return res(403, { err: 'Só o gestor pode abrir o pagamento.' });
    const e = (await rest('empresas?id=eq.' + me.empresa_id + '&select=stripe_customer'))[0];
    if (!e || !e.stripe_customer) return res(400, { err: 'Esta conta não tem assinatura vinculada.' });
    const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ customer: e.stripe_customer, return_url: site() + '/crm.html' })
    });
    const s = await r.json();
    return r.ok && s.url ? res(200, { url: s.url }) : res(502, { err: 'Não foi possível abrir o pagamento.' });
  } catch (e) { return res(500, { err: 'Erro.' }); }
};
