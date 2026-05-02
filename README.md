Audesc Events API v8

Inclui:
- GET /public/eventos
- POST /notificacoes/solicitar
- POST /notificacoes/ativar

SQL necessário:

create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  email text unique,
  email_validado boolean default false,
  receber_todos boolean default false,
  pais text,
  uf text,
  eventos_ids jsonb default '[]'::jsonb,
  ativo boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.notificacoes
add column if not exists email_validado boolean default false;

create unique index if not exists notificacoes_email_unique
on public.notificacoes (email);
