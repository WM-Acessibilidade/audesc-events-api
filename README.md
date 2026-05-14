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


v9 unidade administrativa:
- Corrige o backend para salvar o campo uf para todos os países lusófonos.
- Antes, a API salvava uf apenas quando pais = Brasil.
- Agora, a API limpa uf somente quando pais = Outros.


v10:
- Novo código de sala: audesc + 1 algarismo + 3 caracteres alfanuméricos. Exemplo: audesc7K2P.
- Mantém verificação de unicidade.
- Adiciona DELETE /admin/eventos/:id para exclusão definitiva de eventos.


v11 e-mail Resend:
- Envia e-mail automático ao responsável quando um evento de transmissão Audesc é liberado.
- Variáveis de ambiente necessárias no Render:
  RESEND_API_KEY
  RESEND_FROM_EMAIL
  AUDESC_SITE_URL
- O envio de e-mail não bloqueia a liberação do evento.
- A resposta da API inclui email_resultado.


v12 e-mail admin:
- Permite liberar evento sem enviar e-mail automático.
- Registra status do e-mail no evento, se as colunas existirem.
- Adiciona POST /admin/eventos/:id/reenviar-email.

SQL recomendado no Supabase:

alter table public.eventos
add column if not exists email_liberacao_status text,
add column if not exists email_liberacao_enviado_em timestamp with time zone,
add column if not exists email_liberacao_erro text;
