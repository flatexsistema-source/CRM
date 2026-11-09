// Mostra se as variáveis do Netlify estão preenchidas (sem revelar nenhum valor)
exports.handler = async () => {
  const tem = n => !!process.env[n];
  return {
    statusCode: 200, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      funcoes: 'publicadas',
      variaveis: {
        SUPABASE_URL: tem('SUPABASE_URL'), SUPABASE_SERVICE_KEY: tem('SUPABASE_SERVICE_KEY'), SITE_URL: tem('SITE_URL'),
        GOOGLE_PLACES_KEY: tem('GOOGLE_PLACES_KEY'), STRIPE_SECRET_KEY: tem('STRIPE_SECRET_KEY'),
        STRIPE_WEBHOOK_SECRET: tem('STRIPE_WEBHOOK_SECRET'), RESEND_API_KEY: tem('RESEND_API_KEY'), EMAIL_FROM: tem('EMAIL_FROM')
      }
    }, null, 1)
  };
};
