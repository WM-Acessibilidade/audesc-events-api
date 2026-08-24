v21:
- O webhook do Paddle só processa a confirmação de pagamento uma vez, usando pagamento_confirmado_em como trava.
- Sala e senha geradas são as mesmas salvas no Supabase, enviadas por e-mail e gravadas no Google Sheets.
- Webhooks repetidos não recriam sala/senha nem reenviam e-mail.
SQL recomendado:
alter table public.eventos
add column if not exists planilha_liberacao_status text,
add column if not exists planilha_liberacao_em timestamp with time zone,
add column if not exists planilha_liberacao_erro text;

## Audire Fase 1.0
O backend também expõe rotas isoladas sob `/audire/` para os repositórios permanentes de audiodescrição. Antes de usar o Audire, execute `SQL/audire_fase_1_0.sql`. Para QR dinâmico que aponta para repositório, configure `AUDIRE_PUBLIC_BASE_URL` com a URL pública onde `repositorio.html` está hospedada.
