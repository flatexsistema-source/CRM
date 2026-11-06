/* ==========================================================================
   CONFIGURAÇÃO DO SISTEMA  —  abra este arquivo no BLOCO DE NOTAS para editar
   Troque só o que está entre aspas. Não apague as vírgulas.
   ========================================================================== */
window.CRM_CONFIG = {

  // Nome fantasia do seu CRM (aparece na página de vendas, no login e nos e-mails)
  MARCA: 'Prospera',   

  // Frase curta abaixo do nome
  SLOGAN: 'CRM de prospecção e vendas',

  // Marca do desenvolvedor (aparece no rodapé e no sistema)
  DESENVOLVEDOR: 'Ph Flatex Do Brasil Ltda.',

  // ⚠️ DIGITE SEU WHATSAPP DE VENDAS AQUI (Apenas números com DDD, exemplo: '5519999999999')
  WHATSAPP_VENDAS: '5519998804232',

  // Seus dados reais do Supabase já preenchidos de acordo com seu ID de projeto:
  SUPABASE_URL: 'https://supabase.co',
  
  // ⚠️ VEJA NA ENGRENAGEM > "CHAVES DE API" E COLE A SUA CHAVE "anon public" AQUI DENTRO DAS ASPAS:
  SUPABASE_ANON_KEY: 'COLE_AQUI_A_SUA_ANON_PUBLIC',

  // Planos mostrados enquanto o sistema ainda não está ligado ao Supabase.
  PLANOS_PADRAO: [
    { nome: 'Essencial',    preco_centavos: 12700,  max_usuarios: 3,  descricao: 'Prospecção, follow-up e carteira;Meta diária por vendedor;Pedidos e comissão;Suporte por WhatsApp' },
    { nome: 'Profissional', preco_centavos: 25700, max_usuarios: 10, destaque: true, descricao: 'Tudo do Essencial;Relatório de origem das oportunidades;Regiões e comissões por vendedor;Backup quando você quiser' },
    { nome: 'Empresarial',  preco_centavos: 49700, max_usuarios: 30, descricao: 'Tudo do Profissional;Até 30 usuários;Atendimento prioritário;Treinamento da equipe' }
  ]
};
