-- =====================================================================
--  CRM SaaS — estrutura do banco de dados
--  Como usar: Supabase > SQL Editor > New query > cole TUDO > Run
--  (pode rodar mais de uma vez sem problema)
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------- tabelas base ----------
create table if not exists public.planos(
  id bigint generated always as identity primary key,
  nome text not null,
  preco_centavos integer not null check (preco_centavos >= 0),
  max_usuarios integer not null check (max_usuarios > 0),
  descricao text not null default '',          -- itens separados por ponto e vírgula
  destaque boolean not null default false,
  ativo boolean not null default true,
  ordem integer not null default 0
);

create table if not exists public.empresas(
  id uuid primary key default gen_random_uuid(),
  nome text,
  email text not null,
  plano_id bigint references public.planos(id),
  status text not null default 'aguardando_pagamento'
    check (status in ('aguardando_pagamento','aguardando_pin','ativa','bloqueada','cancelada')),
  stripe_customer text,
  stripe_subscription text,
  vencido_desde date,                           -- data do 1º pagamento em atraso (bloqueia após 15 dias)
  pin_hash text,
  pin_tentativas integer not null default 0,
  criado_em timestamptz not null default now(),
  ativada_em timestamptz
);
create index if not exists empresas_email_idx on public.empresas (lower(email));
create index if not exists empresas_cust_idx on public.empresas (stripe_customer);

create table if not exists public.perfis(
  user_id uuid primary key references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  email text not null,
  role text not null default 'vendedor' check (role in ('dev','admin','vendedor'))
);
create index if not exists perfis_emp_idx on public.perfis (empresa_id);

-- ---------- funções auxiliares (usadas pelas regras de segurança) ----------
create or replace function public.meu_empresa() returns uuid
language sql stable security definer set search_path = public as
$$ select empresa_id from public.perfis where user_id = auth.uid() $$;

create or replace function public.meu_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.perfis where user_id = auth.uid() $$;

create or replace function public.meu_nome() returns text
language sql stable security definer set search_path = public as
$$ select nome from public.perfis where user_id = auth.uid() $$;

-- empresa liberada = status ativa E sem atraso maior que 15 dias
create or replace function public.empresa_ativa(e uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from public.empresas
   where id = e and status = 'ativa'
     and (vencido_desde is null or vencido_desde + 15 > current_date)) $$;

-- ---------- dados do CRM de cada empresa (leads, clientes, pedidos, equipe, configuração) ----------
create table if not exists public.rec(
  id bigint generated always as identity primary key,
  empresa_id uuid not null default public.meu_empresa() references public.empresas(id) on delete cascade,
  kind text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rec_emp_kind_idx on public.rec (empresa_id, kind);

create or replace function public.set_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists rec_updated on public.rec;
create trigger rec_updated before update on public.rec
  for each row execute function public.set_updated_at();

create table if not exists public.config(chave text primary key, valor text not null default '');
create table if not exists public.novidades(
  id bigint generated always as identity primary key,
  titulo text not null, texto text not null default '',
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ---------- regras de segurança (RLS) ----------
alter table public.planos    enable row level security;
alter table public.empresas  enable row level security;
alter table public.perfis    enable row level security;
alter table public.rec       enable row level security;
alter table public.config    enable row level security;
alter table public.novidades enable row level security;

drop policy if exists planos_sel on public.planos;
create policy planos_sel on public.planos for select to anon, authenticated
  using (ativo or public.meu_role() = 'dev');
drop policy if exists planos_dev on public.planos;
create policy planos_dev on public.planos for all to authenticated
  using (public.meu_role() = 'dev') with check (public.meu_role() = 'dev');

drop policy if exists emp_sel on public.empresas;
create policy emp_sel on public.empresas for select to authenticated
  using (id = public.meu_empresa() or public.meu_role() = 'dev');
drop policy if exists emp_upd on public.empresas;
create policy emp_upd on public.empresas for update to authenticated
  using (public.meu_role() = 'dev') with check (public.meu_role() = 'dev');

drop policy if exists perfis_sel on public.perfis;
create policy perfis_sel on public.perfis for select to authenticated
  using (empresa_id = public.meu_empresa() or public.meu_role() = 'dev');

drop policy if exists config_sel on public.config;
create policy config_sel on public.config for select to anon, authenticated using (true);
drop policy if exists config_dev on public.config;
create policy config_dev on public.config for all to authenticated
  using (public.meu_role() = 'dev') with check (public.meu_role() = 'dev');

drop policy if exists nov_sel on public.novidades;
create policy nov_sel on public.novidades for select to authenticated
  using (ativo or public.meu_role() = 'dev');
drop policy if exists nov_dev on public.novidades;
create policy nov_dev on public.novidades for all to authenticated
  using (public.meu_role() = 'dev') with check (public.meu_role() = 'dev');

-- rec: cada empresa só enxerga o que é dela; vendedor só vê os próprios pedidos;
--      só gestor mexe em equipe/configuração e exclui; empresa em atraso (>15 dias) fica bloqueada.
drop policy if exists rec_sel on public.rec;
create policy rec_sel on public.rec for select to authenticated using (
  empresa_id = public.meu_empresa() and public.empresa_ativa(empresa_id)
  and (kind <> 'pedidos' or public.meu_role() in ('admin','dev') or data->>'vendedor' = public.meu_nome()));

drop policy if exists rec_ins on public.rec;
create policy rec_ins on public.rec for insert to authenticated with check (
  empresa_id = public.meu_empresa() and public.empresa_ativa(empresa_id)
  and (kind not in ('users','cfg') or public.meu_role() in ('admin','dev'))
  and (kind <> 'pedidos' or public.meu_role() in ('admin','dev') or data->>'vendedor' = public.meu_nome()));

drop policy if exists rec_upd on public.rec;
create policy rec_upd on public.rec for update to authenticated using (
  empresa_id = public.meu_empresa() and public.empresa_ativa(empresa_id)
  and (kind <> 'pedidos' or public.meu_role() in ('admin','dev') or data->>'vendedor' = public.meu_nome())
  and (kind not in ('users','cfg') or public.meu_role() in ('admin','dev')))
with check (
  empresa_id = public.meu_empresa() and public.empresa_ativa(empresa_id)
  and (kind <> 'pedidos' or public.meu_role() in ('admin','dev') or data->>'vendedor' = public.meu_nome())
  and (kind not in ('users','cfg') or public.meu_role() in ('admin','dev')));

drop policy if exists rec_del on public.rec;
create policy rec_del on public.rec for delete to authenticated using (
  empresa_id = public.meu_empresa() and public.empresa_ativa(empresa_id)
  and public.meu_role() in ('admin','dev'));

-- ---------- funções chamadas pelo CRM ----------
-- "versão" dos dados: o CRM consulta isso a cada poucos segundos para atualizar a tela
create or replace function public.versao() returns text
language sql stable set search_path = public as
$$ select coalesce(max(updated_at)::text,'') || ':' || count(*)::text from public.rec $$;

-- situação da assinatura da empresa de quem está logado
create or replace function public.minha_empresa() returns json
language sql stable security definer set search_path = public as
$$ select json_build_object(
     'id', e.id, 'nome', e.nome, 'status', e.status, 'vencido_desde', e.vencido_desde,
     'bloqueia_em', case when e.vencido_desde is null then null else e.vencido_desde + 15 end,
     'ativa', public.empresa_ativa(e.id), 'plano', p.nome, 'max_usuarios', p.max_usuarios,
     'usuarios', (select count(*) from public.perfis where empresa_id = e.id))
   from public.empresas e left join public.planos p on p.id = e.plano_id
   where e.id = public.meu_empresa() $$;

-- puxar leads: reserva (de forma segura, sem dois vendedores pegarem o mesmo) os próximos leads livres
create or replace function public.puxar_leads(p_n int, p_cidade text default null, p_cidades text[] default null)
returns setof public.rec language sql set search_path = public as
$$ update public.rec r
     set data = r.data || jsonb_build_object('dono', public.meu_nome(), 'por', public.meu_nome(),
           'em', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI')),
         updated_at = now()
   where r.id in (
     select id from public.rec
      where kind = 'leads' and empresa_id = public.meu_empresa()
        and data->>'status' = 'Abordar'
        and coalesce(data->>'dono','') = '' and coalesce(data->>'fone','') <> ''
        and (p_cidade is null or p_cidade = '' or data->>'cidade' = p_cidade)
        and (p_cidades is null or data->>'cidade' = any(p_cidades))
      order by id limit least(p_n, 20) for update skip locked)
   returning r.* $$;

-- ---------- lead aparece na tela na hora (Realtime) + busca rápida do token de captação ----------
do $$ begin
  alter publication supabase_realtime add table public.rec;
exception when duplicate_object then null; when undefined_object then null; end $$;
create index if not exists rec_cfg_token_idx on public.rec ((data->>'token_leads')) where kind = 'cfg';

-- ---------- dados iniciais ----------
insert into public.planos (nome, preco_centavos, max_usuarios, descricao, destaque, ordem)
select * from (values
  ('Essencial',    9700,  3,  'Prospecção, follow-up e carteira;Meta diária por vendedor;Pedidos e comissão;Suporte por WhatsApp', false, 1),
  ('Profissional', 19700, 10, 'Tudo do Essencial;Relatório de origem das oportunidades;Regiões e comissões por vendedor;Backup quando você quiser', true, 2),
  ('Empresarial',  39700, 30, 'Tudo do Profissional;Até 30 usuários;Atendimento prioritário;Treinamento da equipe', false, 3)
) as v(nome, preco_centavos, max_usuarios, descricao, destaque, ordem)
where not exists (select 1 from public.planos);

insert into public.config (chave, valor) values ('whatsapp_suporte',''), ('whatsapp_vendas','')
on conflict (chave) do nothing;

-- =====================================================================
--  SEU CADASTRO COMO DONO / DESENVOLVEDOR  (rode UMA VEZ, depois de criar seu usuário)
--  1) Supabase > Authentication > Users > Add user > "Create new user"
--     (seu e-mail + uma senha + marque "Auto Confirm User")
--  2) Copie o "User UID" desse usuário
--  3) Troque os 3 valores abaixo e rode só este bloco:
--
--  with e as (
--    insert into public.empresas (nome, email, status)
--    values ('Minha empresa (Desenvolvedor)', 'SEU@EMAIL.COM', 'ativa') returning id)
--  insert into public.perfis (user_id, empresa_id, nome, email, role)
--  select 'COLE-AQUI-O-USER-UID', e.id, 'Seu Nome', 'SEU@EMAIL.COM', 'dev' from e;
-- =====================================================================
