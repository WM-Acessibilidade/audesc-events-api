# Audesc Integrador de Eventos v1

Este serviço faz a ponte entre:

- Supabase: cadastro, curadoria e status dos eventos;
- Google Sheets: controle operacional de senhas e salas do Audesc.

## Endpoint principal

```text
POST /liberar-evento/:id
```

Para teste manual pelo navegador, também existe:

```text
GET /liberar-evento/:id?admin_token=SUA_SENHA_ADMINISTRATIVA
```

## Quando libera

Para `tipo_servico = audesc_transmissao`, o evento precisa estar assim:

```text
status_publicacao = aprovado
status_pagamento = pago
```

O integrador:

1. gera senha do transmissor;
2. gera código de sala;
3. grava nova linha na planilha Google Sheets;
4. atualiza o evento no Supabase com senha, sala e `status_operacao = liberado`.

Para `tipo_servico = divulgacao_gratuita`, ele apenas marca `status_operacao = liberado`, sem criar senha e sem gravar na planilha.

## Variáveis de ambiente no Render

```text
ADMIN_TOKEN
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_SHEET_ID
GOOGLE_CLIENT_EMAIL
GOOGLE_PRIVATE_KEY
SHEET_NAME
```

`SHEET_NAME` normalmente é:

```text
eventos
```

## Segurança

Use uma senha forte em `ADMIN_TOKEN`.
