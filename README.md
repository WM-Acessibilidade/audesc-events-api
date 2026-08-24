# Backend Audesc + Audire 1.1

Este backend preserva as rotas existentes do Audesc e acrescenta o domínio isolado do Audire.

Para o Audire:
- publique o mesmo `server.js`;
- instale as dependências do `package.json` (inclui `qrcode`);
- mantenha as variáveis Supabase já existentes;
- configure `AUDIRE_PUBLIC_BASE_URL` para a pasta pública que contém `repositorio.html`;
- opcionalmente configure `AUDIRE_API_PUBLIC_URL` para a URL pública da API.

Os buckets `audire-repositorios` e `audire-roteiros` são criados automaticamente no primeiro upload.
