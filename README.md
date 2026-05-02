Audesc Events API v7

Inclui:
- GET /public/eventos
- POST /notificacoes/preferencias

Rode no Supabase:

create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  email text,
  receber_todos boolean default false,
  pais text,
  uf text,
  eventos_ids jsonb default '[]'::jsonb,
  ativo boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
