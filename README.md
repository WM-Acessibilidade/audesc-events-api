Audesc Events API v5 - localização

Antes de usar, rode no Supabase:

alter table public.eventos
add column if not exists pais text,
add column if not exists uf text;
