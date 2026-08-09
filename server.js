const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const SHEET_NAME = process.env.SHEET_NAME || 'eventos';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const AUDESC_SITE_URL = process.env.AUDESC_SITE_URL || 'https://wm-acessibilidade.github.io/audesc/';
const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
const PADDLE_PRICE_ID = process.env.PADDLE_PRICE_ID;
const PADDLE_CLIENT_TOKEN = process.env.PADDLE_CLIENT_TOKEN;
const PADDLE_ENV = process.env.PADDLE_ENV || 'sandbox';
const PADDLE_API_BASE = PADDLE_ENV === 'live' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';

const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const MERCADOPAGO_PUBLIC_KEY = process.env.MERCADOPAGO_PUBLIC_KEY;
const MERCADOPAGO_ENV = process.env.MERCADOPAGO_ENV || 'sandbox';
const MERCADOPAGO_API_BASE = 'https://api.mercadopago.com';
const MERCADOPAGO_VALOR_EVENTO = Number(process.env.MERCADOPAGO_VALOR_EVENTO || 10);
const MERCADOPAGO_NOTIFICATION_URL = process.env.MERCADOPAGO_NOTIFICATION_URL || 'https://audesc-events-api.onrender.com/webhooks/mercadopago';
const AUDESC_WEB_URL = process.env.AUDESC_WEB_URL || 'https://wm-acessibilidade.github.io/audesc-web';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

// Fase 6.10 — localização inicial aproximada por IP.
// Mantém apenas país e unidade administrativa em cache de memória; não persiste IP, coordenadas ou histórico.
const CACHE_LOCALIZACAO_IP_TTL_MS = 24 * 60 * 60 * 1000;
const cacheLocalizacaoIp = new Map();
function ipCliente(req){
  const encaminhado=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
  const real=String(req.headers['x-real-ip']||'').trim();
  return (encaminhado||real||req.ip||req.socket?.remoteAddress||'').replace(/^::ffff:/,'');
}
function ipPrivadoOuLocal(ip){
  const v=String(ip||'').trim().toLowerCase();
  return !v || v==='::1' || v==='127.0.0.1' || v.startsWith('10.') || v.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(v) || v.startsWith('fc') || v.startsWith('fd');
}
function limparCacheLocalizacaoIp(){
  const agora=Date.now();
  for(const [chave,item] of cacheLocalizacaoIp.entries()) if(!item || item.expiraEm<=agora) cacheLocalizacaoIp.delete(chave);
}


const PAISES_COMERCIAIS = Object.freeze([
  {codigo:'BR',nome:"Brasil",moeda:'BRL',grupo:'lusofono',configurado:true},
  {codigo:'AO',nome:"Angola",moeda:'AOA',grupo:'lusofono',configurado:true},
  {codigo:'CV',nome:"Cabo Verde",moeda:'CVE',grupo:'lusofono',configurado:true},
  {codigo:'GW',nome:"Guiné-Bissau",moeda:'XOF',grupo:'lusofono',configurado:true},
  {codigo:'GQ',nome:"Guiné Equatorial",moeda:'XAF',grupo:'lusofono',configurado:true},
  {codigo:'MZ',nome:"Moçambique",moeda:'MZN',grupo:'lusofono',configurado:true},
  {codigo:'PT',nome:"Portugal",moeda:'EUR',grupo:'lusofono',configurado:true},
  {codigo:'ST',nome:"São Tomé e Príncipe",moeda:'STN',grupo:'lusofono',configurado:true},
  {codigo:'TL',nome:"Timor-Leste",moeda:'USD',grupo:'lusofono',configurado:true},
  {codigo:'US',nome:"Estados Unidos",moeda:'USD',grupo:'prioritario',configurado:true},
  {codigo:'CA',nome:"Canadá",moeda:'CAD',grupo:'prioritario',configurado:true},
  {codigo:'ES',nome:"Espanha",moeda:'EUR',grupo:'prioritario',configurado:true},
  {codigo:'FR',nome:"França",moeda:'EUR',grupo:'prioritario',configurado:true},
  {codigo:'DE',nome:"Alemanha",moeda:'EUR',grupo:'prioritario',configurado:true},
  {codigo:'GB',nome:"Reino Unido",moeda:'GBP',grupo:'prioritario',configurado:true},
  {codigo:'IT',nome:"Itália",moeda:'EUR',grupo:'prioritario',configurado:true},
  {codigo:'NL',nome:"Países Baixos",moeda:'EUR',grupo:'prioritario',configurado:true},
  {codigo:'IE',nome:"Irlanda",moeda:'EUR',grupo:'prioritario',configurado:true},
  {codigo:'CH',nome:"Suíça",moeda:'CHF',grupo:'prioritario',configurado:true},
  {codigo:'AU',nome:"Austrália",moeda:'AUD',grupo:'prioritario',configurado:true},
  {codigo:'NZ',nome:"Nova Zelândia",moeda:'NZD',grupo:'prioritario',configurado:true},
  {codigo:'MX',nome:"México",moeda:'MXN',grupo:'prioritario',configurado:true},
  {codigo:'AR',nome:"Argentina",moeda:'ARS',grupo:'prioritario',configurado:true},
  {codigo:'CL',nome:"Chile",moeda:'CLP',grupo:'prioritario',configurado:true},
  {codigo:'CO',nome:"Colômbia",moeda:'COP',grupo:'prioritario',configurado:true},
  {codigo:'JP',nome:"Japão",moeda:'JPY',grupo:'prioritario',configurado:true},
  {codigo:'KR',nome:"Coreia do Sul",moeda:'KRW',grupo:'prioritario',configurado:true},
  {codigo:'AE',nome:"Emirados Árabes Unidos",moeda:'AED',grupo:'prioritario',configurado:true}
]);
const PAIS_COMERCIAL_POR_CODIGO = new Map(PAISES_COMERCIAIS.map(p=>[p.codigo,p]));
const PAIS_COMERCIAL_POR_NOME = new Map(PAISES_COMERCIAIS.map(p=>[p.nome.toLowerCase(),p]));
const MOEDAS_PADDLE_SUPORTADAS = new Set(['USD','EUR','GBP','JPY','AUD','CAD','CHF','HKD','SGD','SEK','ARS','BRL','CLP','CNY','COP','CZK','DKK','HUF','ILS','INR','KRW','MXN','NOK','NZD','PEN','PLN','RUB','THB','TRY','TWD','UAH','VND','ZAR']);
function recomendacaoComercialPais(metaOuCodigo){
  const meta=typeof metaOuCodigo==='string'?PAIS_COMERCIAL_POR_CODIGO.get(String(metaOuCodigo).toUpperCase()):metaOuCodigo;
  const codigo=String(meta?.codigo||'').toUpperCase();
  const moedaOrigem=String(meta?.moeda||'USD').toUpperCase();
  if(codigo==='BR') return {moeda_origem:moedaOrigem,moeda_recomendada:'BRL',plataforma_recomendada:'mercadopago',fallback_usd:false};
  if(MOEDAS_PADDLE_SUPORTADAS.has(moedaOrigem)) return {moeda_origem:moedaOrigem,moeda_recomendada:moedaOrigem,plataforma_recomendada:'paddle',fallback_usd:false};
  return {moeda_origem:moedaOrigem,moeda_recomendada:'USD',plataforma_recomendada:'paddle',fallback_usd:true};
}
function paisComercialEvento(ev){
  const codigo=String(ev?.pais_codigo||'').trim().toUpperCase();
  if(PAIS_COMERCIAL_POR_CODIGO.has(codigo)) return PAIS_COMERCIAL_POR_CODIGO.get(codigo);
  const nome=String(paisPagamentoEvento(ev)||ev?.pais||'').trim().toLowerCase();
  return PAIS_COMERCIAL_POR_NOME.get(nome)||null;
}
function codigoPaisComercial(ev){return paisComercialEvento(ev)?.codigo||String(ev?.pais_codigo||'').trim().toUpperCase()||null;}
function plataformaDisponivelNoServidor(plataforma,paisCodigo,moeda){
  if(plataforma==='mercadopago') return paisCodigo==='BR' && !!MERCADOPAGO_ACCESS_TOKEN && !!MERCADOPAGO_PUBLIC_KEY;
  if(plataforma==='paddle') return !!PADDLE_API_KEY && !!PADDLE_CLIENT_TOKEN && MOEDAS_PADDLE_SUPORTADAS.has(String(moeda||'').toUpperCase());
  return false;
}
async function obterConfiguracaoComercialPais(paisCodigo, fallbackEv=null){
  const codigo=String(paisCodigo||codigoPaisComercial(fallbackEv)||'').toUpperCase();
  const meta=PAIS_COMERCIAL_POR_CODIGO.get(codigo)||paisComercialEvento(fallbackEv)||{codigo,nome:fallbackEv?.pais||codigo,moeda:'USD'};
  try{
    const {data,error}=await getSupabase().from('configuracao_comercial_pais').select('*').eq('pais_codigo',codigo).maybeSingle();
    if(error) throw error;
    if(data) return Object.assign({},meta,data,{pais_codigo:codigo,moeda:String(data.moeda||meta.moeda||'USD').toUpperCase()});
  }catch(e){console.warn('Configuração comercial por país indisponível:',e.message||e);}
  const recomendada=recomendacaoComercialPais(meta);
  return {pais_codigo:codigo,pais_nome:meta.nome,moeda:recomendada.moeda_recomendada,plataforma_pagamento:recomendada.plataforma_recomendada,pagamentos_ativos:true,...recomendada};
}
function carregarServicosConfig(){
  const padrao = [
    {codigo:'audesc_transmissao',nome:'Transmissão Audesc (transmissor e receptores)',ativo:true,requerAgenda:false,usaTransmissao:true,somenteDivulgacao:false,somenteProfissional:false,permiteValorManual:false},
    {codigo:'divulgacao_gratuita',nome:'Somente divulgação no Audesc',ativo:true,requerAgenda:false,usaTransmissao:false,somenteDivulgacao:true,somenteProfissional:false,permiteValorManual:false},
    {codigo:'audesc_com_audiodescritor',nome:'Serviço completo - Audesc + audiodescritor (legado)',ativo:false,requerAgenda:true,usaTransmissao:true,somenteDivulgacao:false,somenteProfissional:false,permiteValorManual:true},
    {codigo:'somente_audiodescritor',nome:'Audiodescritor',ativo:true,requerAgenda:true,usaTransmissao:false,somenteDivulgacao:false,somenteProfissional:true,permiteValorManual:true},
    {codigo:'somente_consultor',nome:'Consultor',ativo:true,requerAgenda:true,usaTransmissao:false,somenteDivulgacao:false,somenteProfissional:true,permiteValorManual:true}
  ];
  try{
    const file = path.join(__dirname, 'data', 'servicos.json');
    if(fs.existsSync(file)){
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if(Array.isArray(data) && data.length) return data;
    }
  }catch(e){
    console.warn('Não foi possível carregar data/servicos.json. Usando configuração padrão.', e.message || e);
  }
  return padrao;
}
const SERVICOS_CONFIG = carregarServicosConfig();
const SERVICOS_MAP = new Map(SERVICOS_CONFIG.map(s => [s.codigo, s]));
function servicoConfig(codigo){ return SERVICOS_MAP.get(String(codigo || '').trim()) || null; }
function nomeServico(codigo){ return servicoConfig(codigo)?.nome || codigo || '—'; }
function servicoAtivo(codigo){ const s=servicoConfig(codigo); return !!s && s.ativo !== false; }
function listarTiposServicoValidos(){ return SERVICOS_CONFIG.filter(s => s.ativo !== false).map(s => s.codigo); }
function servicoRequerAgenda(codigo){ return !!servicoConfig(codigo)?.requerAgenda; }
function servicoSomenteDivulgacao(codigo){ return !!servicoConfig(codigo)?.somenteDivulgacao; }
function servicoSomenteProfissional(codigo){ return !!servicoConfig(codigo)?.somenteProfissional; }
function servicoUsaTransmissao(codigo){ return !!servicoConfig(codigo)?.usaTransmissao; }

function normalizarServicosSolicitados(valor, tipoLegado=''){
  let itens = Array.isArray(valor) ? valor : (valor ? [valor] : []);
  if(!itens.length && tipoLegado) itens=[tipoLegado];
  itens=itens.flatMap(c => String(c||'').trim()==='audesc_com_audiodescritor' ? ['audesc_transmissao','somente_audiodescritor'] : [String(c||'').trim()]);
  const validos=new Set(SERVICOS_CONFIG.filter(s=>s.ativo!==false && s.codigo!=='audesc_com_audiodescritor').map(s=>s.codigo));
  return [...new Set(itens.filter(c=>validos.has(c)))];
}
function servicosDoEvento(ev){return normalizarServicosSolicitados(ev?.servicos_solicitados, ev?.tipo_servico);}
function eventoUsaTransmissao(ev){return servicosDoEvento(ev).some(servicoUsaTransmissao);}
function eventoTemDivulgacao(ev){return servicosDoEvento(ev).includes('divulgacao_gratuita');}
function eventoRequerAgenda(ev){return servicosDoEvento(ev).some(servicoRequerAgenda);}
function tipoServicoLegado(servicos){
  const itens=normalizarServicosSolicitados(servicos);
  if(itens.includes('audesc_transmissao') && itens.includes('somente_audiodescritor') && itens.length===2) return 'audesc_com_audiodescritor';
  return itens.find(c=>c==='audesc_transmissao') || itens.find(c=>c==='divulgacao_gratuita') || itens[0] || 'audesc_transmissao';
}
function nomesServicosEvento(ev){return servicosDoEvento(ev).map(nomeServico);}

const CATEGORIAS_EVENTO = Object.freeze([
  {codigo:'shows_musica',nome:'Shows e Música'},
  {codigo:'teatro_espetaculos',nome:'Teatro e Espetáculos'},
  {codigo:'standup_comedia',nome:'Stand-up e Comédia'},
  {codigo:'exposicoes_artes',nome:'Exposições e Artes'},
  {codigo:'feiras_mercados',nome:'Feiras e Mercados'},
  {codigo:'gastronomia',nome:'Gastronomia'},
  {codigo:'cursos_oficinas',nome:'Cursos e Oficinas'},
  {codigo:'palestras_networking',nome:'Palestras e Networking'},
  {codigo:'esportes',nome:'Esportes'},
  {codigo:'religiao_espiritualidade',nome:'Religião e Espiritualidade'},
  {codigo:'passeios_experiencias',nome:'Passeios e Experiências'},
  {codigo:'festas_vida_noturna',nome:'Festas e Vida Noturna'},
  {codigo:'institucional_cidadania',nome:'Institucional e Cidadania'},
  {codigo:'outros',nome:'Outros'}
]);
const CATEGORIAS_EVENTO_VALIDAS = new Set(CATEGORIAS_EVENTO.map(c=>c.codigo));
function normalizarCategoriaEvento(valor){
  const codigo=limit(valor,80);
  return CATEGORIAS_EVENTO_VALIDAS.has(codigo) ? codigo : null;
}

const CLASSIFICACOES_ETARIAS = Object.freeze([
  {codigo:'livre',nome:'Livre'},
  {codigo:'10',nome:'10 anos'},
  {codigo:'12',nome:'12 anos'},
  {codigo:'14',nome:'14 anos'},
  {codigo:'16',nome:'16 anos'},
  {codigo:'18',nome:'18 anos'}
]);
const CLASSIFICACOES_ETARIAS_VALIDAS = new Set(CLASSIFICACOES_ETARIAS.map(c=>c.codigo));
function normalizarClassificacaoEtaria(valor){
  const codigo=limit(valor,20);
  return CLASSIFICACOES_ETARIAS_VALIDAS.has(codigo) ? codigo : null;
}


const MODALIDADES_EVENTO_VALIDAS = new Set(['presencial','distancia','hibrido']);
const ABRANGENCIAS_DIVULGACAO_VALIDAS = new Set(['nacional','internacional']);
function normalizarModalidadeEvento(valor){const v=limit(valor,20);return MODALIDADES_EVENTO_VALIDAS.has(v)?v:'presencial';}
function normalizarAbrangenciaDivulgacao(valor, modalidade){if(modalidade==='presencial')return null;const v=limit(valor,20);return ABRANGENCIAS_DIVULGACAO_VALIDAS.has(v)?v:null;}
function normalizarPaisesDivulgacao(valor){const arr=Array.isArray(valor)?valor:[];return [...new Set(arr.map(v=>limit(v,100)).filter(Boolean))].slice(0,100);}

function defaultFormularioConfig(){
  const codigos = listarTiposServicoValidos();
  const basicos = codigos.filter(c => c === 'audesc_transmissao' || c === 'divulgacao_gratuita');
  const todos = codigos.slice();
  return {
    versao: 1,
    atualizado_em: null,
    padrao: {
      servicosDisponiveis: basicos.length ? basicos : todos,
      campos: {
        descricao_original: { visivel: true, obrigatorio: false },
        categoria_evento: { visivel: true, obrigatorio: true },
        classificacao_etaria: { visivel: true, obrigatorio: false },
        modalidade_evento: { visivel: true, obrigatorio: true },
        abrangencia_divulgacao: { visivel: true, obrigatorio: true },
        paises_divulgacao: { visivel: true, obrigatorio: true },
        tipo_evento: { visivel: true, obrigatorio: true },
        divulgar_acesso_ouvintes: { visivel: true, obrigatorio: false },
        data_evento: { visivel: true, obrigatorio: false },
        duracao_horas: { visivel: true, obrigatorio: true },
        max_ouvintes: { visivel: true, obrigatorio: true },
        local_evento: { visivel: true, obrigatorio: false },
        latitude: { visivel: true, obrigatorio: false },
        longitude: { visivel: true, obrigatorio: false },
        site_oficial: { visivel: true, obrigatorio: false },
        link_ingressos: { visivel: true, obrigatorio: false },
        link_inscricao: { visivel: true, obrigatorio: false },
        link_programacao: { visivel: true, obrigatorio: false },
        link_acessibilidade: { visivel: true, obrigatorio: false }
      },
      limites: {
        titulo_original: { limitarMinimo: true, minimo: 10, limitarMaximo: true, maximo: 150 },
        descricao_original: { limitarMinimo: true, minimo: 100, limitarMaximo: true, maximo: 1500 }
      }
    },
    regras: [
      {
        pais_codigo: 'BR',
        unidade_codigo: 'DF',
        nome: 'Brasil - Distrito Federal',
        servicosDisponiveis: todos,
        campos: {}
      }
    ]
  };
}
function sanitizarFormularioConfig(input){
  const base = defaultFormularioConfig();
  const cfg = input && typeof input === 'object' ? input : {};
  const validos = new Set(listarTiposServicoValidos());
  function limpaServicos(arr, fallback){
    const list = Array.isArray(arr) ? arr : fallback;
    return [...new Set((list || []).filter(c => validos.has(c)))];
  }
  function limpaCampo(v, def={visivel:true, obrigatorio:false}){
    const obj = v && typeof v === 'object' ? v : {};
    return { visivel: obj.visivel !== false, obrigatorio: !!obj.obrigatorio };
  }
  function limpaLimite(v, def){
    const obj = v && typeof v === 'object' ? v : {};
    const minimo = Math.max(0, Math.min(10000, Number(obj.minimo ?? obj.min ?? def.minimo ?? 0)));
    const maximo = Math.max(1, Math.min(50000, Number(obj.maximo ?? obj.max ?? def.maximo ?? 5000)));
    return {
      limitarMinimo: obj.limitarMinimo !== false,
      minimo: Math.min(minimo, maximo),
      limitarMaximo: obj.limitarMaximo !== false,
      maximo
    };
  }
  function limpaRegrasPorServico(v, fallback={}){
    const out = {};
    const fonte = v && typeof v === 'object' ? v : fallback;
    const comportamentos = new Set(['usuario','fixo','oculto_sem_valor']);
    for(const codigo of Object.keys(fonte || {})){
      if(!validos.has(codigo)) continue;
      const item = fonte[codigo] && typeof fonte[codigo] === 'object' ? fonte[codigo] : {};
      const camposFonte = item.campos && typeof item.campos === 'object' ? item.campos : {};
      const camposServico = {};
      for(const campo of Object.keys(base.padrao.campos)){
        if(!Object.prototype.hasOwnProperty.call(camposFonte, campo)) continue;
        const c = camposFonte[campo] && typeof camposFonte[campo] === 'object' ? camposFonte[campo] : {};
        const comportamentoInformado = c.comportamento || c.modo;
        const comportamento = comportamentos.has(comportamentoInformado) ? comportamentoInformado : 'usuario';
        let valor = c.valor;
        if(campo === 'tipo_evento' && valor !== 'privado') valor = 'publico';
        if(campo === 'divulgar_acesso_ouvintes') valor = valor === true || String(valor ?? '').trim() === 'true';
        camposServico[campo] = { comportamento, valor: valor ?? '' };
      }
      out[codigo] = { campos: camposServico };
    }
    return out;
  }
  const camposBase = Object.assign({}, base.padrao.campos, cfg.padrao?.campos || {});
  const campos = {};
  for(const k of Object.keys(base.padrao.campos)) campos[k] = limpaCampo(camposBase[k], base.padrao.campos[k]);
  const limitesBase = Object.assign({}, base.padrao.limites, cfg.padrao?.limites || {});
  const limites = {};
  for(const k of Object.keys(base.padrao.limites)) limites[k] = limpaLimite(limitesBase[k], base.padrao.limites[k]);
  const regrasPorServicoPadrao = limpaRegrasPorServico(cfg.padrao?.regrasPorServico, base.padrao.regrasPorServico || {});
  const regras = Array.isArray(cfg.regras) ? cfg.regras.map(r => {
    const pais = limit(r.pais_codigo || r.paisCodigo || '', 8).toUpperCase();
    const unidade = limit(r.unidade_codigo || r.unidadeCodigo || '', 30).toUpperCase();
    if(!pais || !unidade) return null;
    const camposRegra = {};
    const rc = r.campos && typeof r.campos === 'object' ? r.campos : {};
    for(const k of Object.keys(base.padrao.campos)){
      if(Object.prototype.hasOwnProperty.call(rc,k)) camposRegra[k] = limpaCampo(rc[k], campos[k]);
    }
    const limitesRegra = {};
    const rl = r.limites && typeof r.limites === 'object' ? r.limites : {};
    for(const k of Object.keys(base.padrao.limites)){
      if(Object.prototype.hasOwnProperty.call(rl,k)) limitesRegra[k] = limpaLimite(rl[k], limites[k]);
    }
    return {
      pais_codigo: pais,
      unidade_codigo: unidade,
      nome: limit(r.nome || '', 160),
      servicosDisponiveis: limpaServicos(r.servicosDisponiveis, base.padrao.servicosDisponiveis),
      campos: camposRegra,
      limites: limitesRegra,
      regrasPorServico: limpaRegrasPorServico(r.regrasPorServico, {})
    };
  }).filter(Boolean) : base.regras;
  return {
    versao: 1,
    atualizado_em: new Date().toISOString(),
    padrao: {
      servicosDisponiveis: limpaServicos(cfg.padrao?.servicosDisponiveis, base.padrao.servicosDisponiveis),
      campos,
      limites,
      regrasPorServico: regrasPorServicoPadrao
    },
    regras
  };
}
async function obterFormularioConfig(){
  const fallback = defaultFormularioConfig();
  try{
    const {data,error} = await getSupabase().from('formulario_config').select('config').eq('id','default').maybeSingle();
    if(error) throw error;
    if(data?.config) return sanitizarFormularioConfig(data.config);
  }catch(e){
    console.warn('Usando configuração padrão do formulário:', e.message || e);
  }
  return fallback;
}
function resolverFormularioConfigParaLocal(config, paisCodigo, unidadeCodigo){
  const cfg = sanitizarFormularioConfig(config);
  const pais = String(paisCodigo || '').toUpperCase();
  const unidade = String(unidadeCodigo || '').toUpperCase();
  const regra = cfg.regras.find(r => r.pais_codigo === pais && r.unidade_codigo === unidade);
  const campos = Object.assign({}, cfg.padrao.campos, regra?.campos || {});
  const limites = Object.assign({}, cfg.padrao.limites, regra?.limites || {});
  const regrasPorServico = Object.assign({}, cfg.padrao.regrasPorServico || {}, regra?.regrasPorServico || {});
  return {
    servicosDisponiveis: regra?.servicosDisponiveis?.length ? regra.servicosDisponiveis : cfg.padrao.servicosDisponiveis,
    campos,
    limites,
    regrasPorServico
  };
}

function validarTextoConfigurado(valor, nomeCampo, cfgLimite, obrigatorio=false){
  const bruto = String(valor ?? '');
  const textoLimpo = bruto.trim();
  const limite = cfgLimite && typeof cfgLimite === 'object' ? cfgLimite : {};
  const minimo = Math.max(0, Number(limite.minimo || 0));
  const maximo = Math.max(1, Number(limite.maximo || 5000));
  if(obrigatorio && !textoLimpo) throw new Error(`Informe ${nomeCampo}.`);
  if(textoLimpo || obrigatorio){
    if(limite.limitarMinimo !== false && minimo > 0 && textoLimpo.length < minimo){
      throw new Error(`${nomeCampo} deve ter pelo menos ${minimo} caracteres.`);
    }
    if(limite.limitarMaximo !== false && maximo > 0 && textoLimpo.length > maximo){
      throw new Error(`${nomeCampo} não pode ultrapassar ${maximo} caracteres.`);
    }
  }
  const corteSeguro = limite.limitarMaximo !== false ? maximo : 5000;
  return limit(textoLimpo, corteSeguro);
}



function text(v){ return String(v || '').trim(); }
function limit(v,n){ return text(v).slice(0,n); }
function safeUrl(v){ const u=text(v); if(!u) return ''; try{ const p=new URL(u); return p.protocol==='https:'?p.toString():'';}catch{return '';} }
function getSupabase(){ if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase não configurado.'); return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY); }
async function getUser(req){ const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):''; if(!token) return null; const {data,error}=await getSupabase().auth.getUser(token); if(error || !data || !data.user) return null; return data.user; }
function password6(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s='';
  for(let i=0;i<6;i++) s+=c[crypto.randomInt(0,c.length)];
  return s;
}
function makeRoom(){
  const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const numero = String(crypto.randomInt(0, 10));
  let sufixo = '';
  for(let i=0;i<3;i++){
    sufixo += caracteres[crypto.randomInt(0, caracteres.length)];
  }
  return 'audesc' + numero + sufixo;
}
async function getSheets(){
  if(!GOOGLE_SHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) throw new Error('Google Sheets não configurado.');
  const auth=new google.auth.JWT({
    email:GOOGLE_CLIENT_EMAIL,
    key:GOOGLE_PRIVATE_KEY,
    scopes:['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({version:'v4',auth});
}
function endDate(start,hours){ const d=start?new Date(start):new Date(); return new Date(d.getTime()+Number(hours||2)*3600000).toISOString(); }
function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
function erroGoogleTemporario(e){
  const msg = String(e && e.message ? e.message : e || '').toLowerCase();
  const code = e && (e.code || e.status || e.statusCode || e.response?.status);
  return [408,429,500,502,503,504].includes(Number(code)) ||
    msg.includes('premature close') ||
    msg.includes('socket hang up') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('temporarily unavailable');
}
async function appendSheetOnce(ev,senha,sala){
  const sheets=await getSheets();
  const title=ev.titulo_publicado||ev.titulo_original||'Evento Audesc';
  const start=ev.data_evento||new Date().toISOString();
  const row=[senha,sala,title,ev.max_ouvintes||20,ev.duracao_horas||2,start,endDate(start,ev.duracao_horas),'ativo','sim',10,'','','',''];
  await sheets.spreadsheets.values.append({
    spreadsheetId:GOOGLE_SHEET_ID,
    range:`${SHEET_NAME}!A:N`,
    valueInputOption:'USER_ENTERED',
    insertDataOption:'INSERT_ROWS',
    requestBody:{values:[row]}
  });
}
async function appendSheet(ev,senha,sala){
  const atrasos = [0, 800, 2000, 5000];
  let ultimoErro = null;
  for(let tentativa=0; tentativa<atrasos.length; tentativa++){
    if(atrasos[tentativa]) await sleep(atrasos[tentativa]);
    try{
      await appendSheetOnce(ev,senha,sala);
      if(tentativa>0) console.log(`Google Sheets: ordem salva após ${tentativa+1} tentativas.`);
      return;
    }catch(e){
      ultimoErro = e;
      const msg = e && e.message ? e.message : String(e);
      console.warn(`Google Sheets: falha ao salvar ordem, tentativa ${tentativa+1}/${atrasos.length}:`, msg);
      if(!erroGoogleTemporario(e) || tentativa === atrasos.length-1) break;
    }
  }
  const msg = ultimoErro && ultimoErro.message ? ultimoErro.message : String(ultimoErro || 'erro desconhecido');
  throw new Error(msg + ' (após tentativas automáticas de reconexão com o Google Sheets)');
}


async function atualizarStatusPlanilhaLiberacao(sb, eventoId, status, erro){
  try{
    const payload = {
      planilha_liberacao_status: status,
      planilha_liberacao_em: new Date().toISOString()
    };
    if(erro) payload.planilha_liberacao_erro = limit(String(erro), 2000);
    if(!erro) payload.planilha_liberacao_erro = null;
    const { error } = await sb.from('eventos').update(payload).eq('id', eventoId);
    if(error) console.warn('Não foi possível registrar status da planilha:', error.message || error);
  }catch(e){
    console.warn('Falha ao registrar status da planilha:', e.message || e);
  }
}

// Mantém compatibilidade com versões anteriores do código que chamavam registrarStatusPlanilha.
async function registrarStatusPlanilha(eventoId, status, erro){
  return atualizarStatusPlanilhaLiberacao(getSupabase(), eventoId, status, erro);
}

function resumirErroGoogleSheets(e){
  const msg = e && e.message ? e.message : String(e || 'erro desconhecido');
  const code = e && (e.code || e.status || e.statusCode || e.response?.status);
  return { mensagem: msg, codigo: code || null };
}

function validarVariaveisGoogleSheets(){
  const faltantes = [];
  if(!GOOGLE_SHEET_ID) faltantes.push('GOOGLE_SHEET_ID');
  if(!GOOGLE_CLIENT_EMAIL) faltantes.push('GOOGLE_CLIENT_EMAIL');
  if(!GOOGLE_PRIVATE_KEY) faltantes.push('GOOGLE_PRIVATE_KEY');
  if(!SHEET_NAME) faltantes.push('SHEET_NAME');
  return {
    ok: faltantes.length === 0,
    faltantes,
    sheet_id_configurado: !!GOOGLE_SHEET_ID,
    client_email_configurado: !!GOOGLE_CLIENT_EMAIL,
    private_key_configurada: !!GOOGLE_PRIVATE_KEY,
    private_key_formato_aparente: GOOGLE_PRIVATE_KEY ? (GOOGLE_PRIVATE_KEY.includes('BEGIN PRIVATE KEY') && GOOGLE_PRIVATE_KEY.includes('END PRIVATE KEY')) : false,
    sheet_name: SHEET_NAME || null
  };
}

async function diagnosticarGoogleSheets(){
  const cfg = validarVariaveisGoogleSheets();
  const resultado = {
    ok: false,
    configuracao: cfg,
    autenticacao: { ok:false },
    planilha: { ok:false },
    leitura: { ok:false },
    timestamp: new Date().toISOString()
  };
  if(!cfg.ok){
    resultado.erro = 'Variáveis de ambiente do Google Sheets incompletas.';
    return resultado;
  }
  try{
    const auth = new google.auth.JWT({
      email: GOOGLE_CLIENT_EMAIL,
      key: GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    await auth.getAccessToken();
    resultado.autenticacao = { ok:true };
    const sheets = google.sheets({version:'v4', auth});
    const meta = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields:'spreadsheetId,properties.title,sheets.properties.title' });
    const abas = (meta.data.sheets || []).map(x => x.properties && x.properties.title).filter(Boolean);
    resultado.planilha = { ok:true, titulo: meta.data.properties?.title || null, abas };
    const abaExiste = abas.includes(SHEET_NAME);
    if(!abaExiste){
      resultado.leitura = { ok:false, erro:`A aba "${SHEET_NAME}" não foi encontrada na planilha.` };
      resultado.ok = false;
      return resultado;
    }
    const leitura = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range:`${SHEET_NAME}!A1:N1` });
    resultado.leitura = { ok:true, primeira_linha_encontrada: Array.isArray(leitura.data.values) && leitura.data.values.length > 0 };
    resultado.ok = true;
    return resultado;
  }catch(e){
    const erro = resumirErroGoogleSheets(e);
    if(!resultado.autenticacao.ok) resultado.autenticacao = { ok:false, erro:erro.mensagem, codigo:erro.codigo };
    else if(!resultado.planilha.ok) resultado.planilha = { ok:false, erro:erro.mensagem, codigo:erro.codigo };
    else resultado.leitura = { ok:false, erro:erro.mensagem, codigo:erro.codigo };
    resultado.erro = erro.mensagem;
    resultado.codigo = erro.codigo;
    return resultado;
  }
}

async function gerarCredenciaisTransmissao(ev, sb){
  const senha = ev.senha_transmissor || await gerarSenhaUnica(sb);
  const sala = ev.sala_codigo || await gerarSalaUnica(sb);
  return { senha, sala };
}

async function salvarOrdemNaPlanilhaOuFalhar(ev, senha, sala, sb){
  try{
    await appendSheet(ev, senha, sala);
    await atualizarStatusPlanilhaLiberacao(sb, ev.id, 'salvo', null);
    return { ok:true };
  }catch(e){
    const msg = e && e.message ? e.message : String(e);
    console.error('Falha ao salvar ordem na planilha:', msg);
    await atualizarStatusPlanilhaLiberacao(sb, ev.id, 'erro', msg);
    throw new Error('Não foi possível gerar a ordem na planilha Google. O evento não foi liberado. Detalhe: ' + msg);
  }
}


function numeroCoordenada(v){
  if(v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function paisPagamentoEvento(ev){
  const pais = String(ev?.pais || '').trim();
  if(pais.toLowerCase() === 'internacional' && ev?.origem_transmissao){
    return String(ev.origem_transmissao || '').trim();
  }
  return pais;
}

function moedaDoEvento(ev){
  const meta=paisComercialEvento(ev);
  if(meta?.moeda) return meta.moeda;
  const pais = paisPagamentoEvento(ev).toLowerCase();
  if(pais === 'brasil') return 'BRL';
  if(pais === 'portugal') return 'EUR';
  return 'USD';
}

function arredondarValor(v){
  return Math.max(0, Math.round(Number(v || 0) * 100) / 100);
}

async function obterPrecificacao(moeda, tipoServico){
  const servico = text(tipoServico) || 'audesc_transmissao';
  try{
    const { data: servicoData, error: servicoError } = await getSupabase()
      .from('precificacao_servicos')
      .select('*')
      .eq('moeda', moeda)
      .eq('tipo_servico', servico)
      .maybeSingle();
    if(servicoError) throw servicoError;
    if(servicoData) return servicoData;
  }catch(e){
    console.warn('Usando precificacao padrão:', e.message || e);
  }

  const { data, error } = await getSupabase()
    .from('precificacao')
    .select('*')
    .eq('moeda', moeda)
    .single();

  if(error) throw error;
  if(!data) throw new Error('Precificação não encontrada para a moeda '+moeda+'.');
  return data;
}

function calcularValorPacote(ev, precificacao){
  const ouvintesMinimos = Number(precificacao.ouvintes_minimos || 10);
  const duracaoMinima = Number(precificacao.duracao_minima_horas || 1);
  const base = Number(precificacao.valor_base_10_ouvintes_1_hora || 0);
  const acrescimo = Number(precificacao.acrescimo_por_10_ouvintes || 0);

  const ouvintes = Math.max(ouvintesMinimos, Number(ev.max_ouvintes || ouvintesMinimos));
  const duracao = Math.max(duracaoMinima, Number(ev.duracao_horas || duracaoMinima));

  const blocosAdicionais = Math.max(0, Math.ceil((ouvintes - ouvintesMinimos) / 10));
  const valorPorHora = base + (blocosAdicionais * acrescimo);
  const total = arredondarValor(valorPorHora * duracao);

  return {
    moeda: precificacao.moeda,
    ouvintes,
    duracao_horas: duracao,
    valor_por_hora: arredondarValor(valorPorHora),
    valor_original: total,
    blocos_adicionais: blocosAdicionais
  };
}


function numeroSeguro(v, padrao=0){const n=Number(v);return Number.isFinite(n)?n:padrao;}
async function obterPrecoServico(tipoServico, moeda, paisCodigo){
 const servico=text(tipoServico)||'audesc_transmissao';
 const codigo=String(paisCodigo||'').toUpperCase();
 if(codigo){
  try{
   const {data,error}=await getSupabase().from('precificacao_pais_servicos').select('*').eq('pais_codigo',codigo).eq('tipo_servico',servico).maybeSingle();
   if(error) throw error;
   if(data) return data;
  }catch(e){console.warn('Preço por país indisponível:',e.message||e);}
 }
 try{
  const {data,error}=await getSupabase().from('precificacao_servicos').select('*').eq('tipo_servico',servico).eq('moeda',moeda).maybeSingle();
  if(error) throw error;
  return data||null;
 }catch(e){console.warn('Preço de serviço indisponível:',e.message||e);return null;}
}
function aplicarDescontoPromocional(valor,percentual){
 const p=Math.max(0,Math.min(100,numeroSeguro(percentual,0)));
 const desconto=arredondarValor(valor*(p/100));
 return {percentual:p,desconto,valor_promocional:arredondarValor(valor-desconto)};
}
async function calcularValorBaseServico(ev, moeda, paisCodigo){
 const servicos=servicosDoEvento(ev);
 const duracao=Math.max(1,Number(ev.duracao_horas||1));
 const detalhes=[];
 let valorTabela=0, descontoPromocional=0, total=0, ouvintes=null;
 for(const tipo of servicos){
  const preco=await obterPrecoServico(tipo,moeda,paisCodigo);
  if(tipo==='audesc_transmissao'){
   const p=preco||await obterPrecificacao(moeda,'audesc_transmissao');
   const pacote=calcularValorPacote(ev,p);
   const promo=aplicarDescontoPromocional(pacote.valor_original,p?.desconto_percentual);
   valorTabela+=pacote.valor_original; descontoPromocional+=promo.desconto; total+=promo.valor_promocional; ouvintes=pacote.ouvintes;
   detalhes.push({tipo_servico:tipo,descricao:nomeServico(tipo),valor_tabela:pacote.valor_original,desconto_percentual:promo.percentual,desconto_promocional:promo.desconto,valor:promo.valor_promocional});
  }else{
   const base=preco?numeroSeguro(preco.valor_hora,preco.valor_base_10_ouvintes_1_hora):0;
   const bruto=servicoRequerAgenda(tipo)?arredondarValor(base*duracao):arredondarValor(base);
   const promo=aplicarDescontoPromocional(bruto,preco?.desconto_percentual);
   valorTabela+=bruto; descontoPromocional+=promo.desconto; total+=promo.valor_promocional;
   detalhes.push({tipo_servico:tipo,descricao:nomeServico(tipo),valor_tabela:bruto,desconto_percentual:promo.percentual,desconto_promocional:promo.desconto,valor:promo.valor_promocional,valor_unitario:base});
  }
 }
 return {valor_tabela:arredondarValor(valorTabela),desconto_promocional:arredondarValor(descontoPromocional),valor_original:arredondarValor(total),ouvintes,duracao_horas:duracao,servicos_solicitados:servicos,tipo_servico:tipoServicoLegado(servicos),detalhes:{itens:detalhes,descricao:detalhes.map(d=>d.descricao).join(' + ')}};
}


function valorNumericoOuNull(v){
  if(v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? arredondarValor(n) : null;
}

async function calcularValorSugeridoAgenda(ev){
  const cfg=await obterConfiguracaoComercialPais(null,ev);
  const moeda=cfg.moeda;
  const pacote = await calcularValorBaseServico(ev, moeda, cfg.pais_codigo);
  if(!pacote) return { moeda, valor_sugerido_agenda: 0, pacote: null };
  return { moeda, valor_sugerido_agenda: arredondarValor(pacote.valor_original), pacote };
}

function aplicarValorFinalAgendaSeExistir(ev, pacote){
  if(!requerAgendaProfissional(ev)) return pacote;
  const valorFinalAgenda = valorNumericoOuNull(ev.valor_final_agenda);
  if(valorFinalAgenda === null) return pacote;
  return Object.assign({}, pacote, {
    valor_original: valorFinalAgenda,
    valor_final_agenda: valorFinalAgenda,
    valor_sugerido_agenda: valorNumericoOuNull(ev.valor_sugerido_agenda),
    detalhes: Object.assign({}, pacote.detalhes || {}, {
      valor_sugerido_agenda: valorNumericoOuNull(ev.valor_sugerido_agenda),
      valor_final_definido_pelo_admin: valorFinalAgenda,
      valor_base_original_calculado: pacote.valor_original
    })
  });
}

async function calcularPagamentoEvento(ev, codigoCupom){
  const configComercial=await obterConfiguracaoComercialPais(null,ev);
  const moeda=configComercial.moeda;
  const paisCodigo=configComercial.pais_codigo;
  const servicoCalculado = await calcularValorBaseServico(ev, moeda, paisCodigo);
  let pacote = servicoCalculado || calcularValorPacote(ev, await obterPrecificacao(moeda, ev.tipo_servico));
  pacote = aplicarValorFinalAgendaSeExistir(ev, pacote);

  let cupom = null;
  let descontoCupom = 0;
  const codigo = text(codigoCupom).toUpperCase();
  if(codigo){
    const { data: cupomData, error: cupomError } = await getSupabase().from('cupons').select('*').eq('codigo', codigo).maybeSingle();
    if(cupomError) throw cupomError;
    if(!cupomData) throw new Error('Cupom não encontrado.');
    if(!cupomData.ativo) throw new Error('Cupom inativo.');
    if(cupomData.validade && new Date(cupomData.validade).getTime() < Date.now()) throw new Error('Cupom expirado.');
    if(cupomData.limite_uso != null && Number(cupomData.usos_realizados || 0) >= Number(cupomData.limite_uso)) throw new Error('Cupom esgotado.');
    if(cupomData.pais_codigo && String(cupomData.pais_codigo).toUpperCase()!==paisCodigo) throw new Error('Este cupom não é válido para o país deste pagamento.');
    if(!cupomData.pais_codigo && cupomData.moeda && cupomData.moeda !== moeda) throw new Error('Este cupom não é válido para a moeda deste pagamento.');
    const aplicaveis=Array.isArray(cupomData.servicos_aplicaveis)?cupomData.servicos_aplicaveis:[];
    if(aplicaveis.length && !servicosDoEvento(ev).some(s=>aplicaveis.includes(s))) throw new Error('Este cupom não é aplicável aos serviços selecionados.');
    if(cupomData.tipo_desconto === 'percentual') descontoCupom = pacote.valor_original * (Number(cupomData.valor_desconto || 0) / 100);
    else descontoCupom = Number(cupomData.valor_desconto || 0);
    descontoCupom = Math.min(pacote.valor_original, arredondarValor(descontoCupom));
    cupom = cupomData;
  }
  const valorFinal = arredondarValor(pacote.valor_original - descontoCupom);
  return {
    pais_codigo:paisCodigo,
    moeda,
    plataforma_pagamento:configComercial.plataforma_pagamento,
    pagamentos_ativos:configComercial.pagamentos_ativos!==false,
    plataforma_disponivel:plataformaDisponivelNoServidor(configComercial.plataforma_pagamento,paisCodigo,moeda),
    pacote,
    cupom,
    cupom_codigo: cupom ? cupom.codigo : null,
    valor_tabela: pacote.valor_tabela ?? pacote.valor_original,
    desconto_promocional: pacote.desconto_promocional || 0,
    desconto_aplicado: descontoCupom,
    valor_original: pacote.valor_original,
    valor_final: valorFinal
  };
}

function valorMenorUnidade(valor){
  return String(Math.round(Number(valor || 0) * 100));
}

async function registrarDadosPagamentoEvento(eventoId, dados, provedor, referencia){
  await getSupabase().from('eventos').update({
    moeda_pagamento: dados.moeda,
    valor_original: dados.valor_original,
    cupom_codigo: dados.cupom_codigo,
    desconto_aplicado: dados.desconto_aplicado,
    valor_final: dados.valor_final,
    pagamento_provedor: provedor,
    pagamento_referencia: referencia || null,
    data_ultima_edicao: new Date().toISOString()
  }).eq('id', eventoId);
}

async function incrementarUsoCupomSeAplicavel(codigo){
  const c = text(codigo).toUpperCase();
  if(!c) return;
  try{
    const { data: cupom, error } = await getSupabase().from('cupons').select('*').eq('codigo', c).maybeSingle();
    if(error || !cupom) return;
    await getSupabase().from('cupons').update({
      usos_realizados: Number(cupom.usos_realizados || 0) + 1,
      atualizado_em: new Date().toISOString()
    }).eq('id', cupom.id);
  }catch(e){
    console.warn('Não foi possível incrementar uso do cupom:', e.message || e);
  }
}




async function obterStatusEmail(email){
  const e = text(email).toLowerCase();
  if(!e) return {email:'',status:'comum'};
  const {data,error} = await getSupabase().from('email_status').select('*').eq('email', e).maybeSingle();
  if(error) throw error;
  return data || {email:e,status:'comum'};
}

async function emailBloqueado(email){
  const st = await obterStatusEmail(email);
  return st.status === 'bloqueado';
}

async function emailConfiavel(email){
  const st = await obterStatusEmail(email);
  return st.status === 'confiavel';
}



function base64UrlEncode(input){
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf.toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function assinarJwtHs256(payload, secret){
  const header = { alg:'HS256', typ:'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(encodedHeader + '.' + encodedPayload).digest();
  return encodedHeader + '.' + encodedPayload + '.' + base64UrlEncode(signature);
}


function normalizarCodigoSalaBusca(v){
  return String(v || '').trim();
}

async function buscarEventoPorSala(sb, sala, campos){
  const codigo = normalizarCodigoSalaBusca(sala);
  if(!codigo) return null;
  const selectCampos = campos || 'id,titulo_original,titulo_publicado,sala_codigo,senha_transmissor,status_operacao,status_publicacao';

  async function tentarEq(valor){
    const {data,error}=await sb.from('eventos').select(selectCampos).eq('sala_codigo', valor).limit(1);
    if(error) throw error;
    return data && data.length ? data[0] : null;
  }

  async function tentarIlike(valor){
    const seguro = String(valor).replace(/[%_]/g, '\\$&');
    const {data,error}=await sb.from('eventos').select(selectCampos).ilike('sala_codigo', seguro).limit(1);
    if(error) throw error;
    return data && data.length ? data[0] : null;
  }

  const candidatos = Array.from(new Set([codigo, decodeURIComponent(codigo)].filter(Boolean)));
  for(const c of candidatos){
    const exato = await tentarEq(c);
    if(exato) return exato;
  }
  for(const c of candidatos){
    const aproximado = await tentarIlike(c);
    if(aproximado) return aproximado;
  }

  // Compatibilidade extra: alguns códigos podem ter diferenças de espaço, maiúsculas/minúsculas ou caracteres invisíveis.
  const alvo = codigo.toLowerCase().replace(/\s+/g,'');
  const {data,error}=await sb.from('eventos').select(selectCampos).not('sala_codigo','is',null).order('created_at',{ascending:false}).limit(500);
  if(error) throw error;
  return (data || []).find(ev => String(ev.sala_codigo || '').trim().toLowerCase().replace(/\s+/g,'') === alvo) || null;
}



function normalizarCabecalhoPlanilha(v){
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'_')
    .replace(/^_+|_+$/g,'');
}
function celulaIgualCodigo(a,b){
  return String(a || '').trim().toLowerCase().replace(/\s+/g,'') === String(b || '').trim().toLowerCase().replace(/\s+/g,'');
}

function numeroOuNull(v){
  if(v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function gpsConfigEvento(ev){
  const exigir = ev && (ev.exigir_gps_ouvintes === true || String(ev.exigir_gps_ouvintes || '').toLowerCase() === 'true');
  const lat = numeroOuNull(ev && ev.latitude);
  const lon = numeroOuNull(ev && ev.longitude);
  const raio = Math.max(10, Math.min(5000, Math.floor(Number((ev && ev.gps_raio_metros) || 200))));
  const precisaoMax = Math.max(10, Math.min(5000, Math.floor(Number((ev && ev.gps_precisao_max_metros) || 500))));
  return {exigir, latitude:lat, longitude:lon, raio_metros:raio, precisao_max_metros:precisaoMax, configurado: exigir && lat !== null && lon !== null};
}
function distanciaMetros(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const p1 = toRad(lat1), p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function validarGpsOuvinte(ev, query){
  const cfg = gpsConfigEvento(ev);
  if(!cfg.exigir) return {ok:true, exigido:false, config:cfg};
  if(!cfg.configurado){
    return {ok:false, exigido:true, config:cfg, error:'Este evento exige presença no local, mas as coordenadas do evento não estão configuradas.'};
  }
  const lat = numeroOuNull(query.lat || query.latitude);
  const lon = numeroOuNull(query.lon || query.lng || query.longitude);
  const acc = Math.max(0, Number(query.accuracy || query.precisao || 0));
  if(lat === null || lon === null){
    return {ok:false, exigido:true, config:cfg, error:'Para entrar nesta transmissão, permita o acesso à localização do dispositivo.'};
  }
  if(acc && acc > cfg.precisao_max_metros){
    return {ok:false, exigido:true, config:cfg, distancia_metros:null, precisao_metros:acc, error:`A localização informada está imprecisa demais (${Math.round(acc)} m). Tente novamente em local aberto ou mais próximo do evento.`};
  }
  const dist = distanciaMetros(cfg.latitude, cfg.longitude, lat, lon);
  // Considera a margem de precisão do GPS a favor do ouvinte para evitar bloqueios injustos.
  const distanciaAjustada = Math.max(0, dist - (Number.isFinite(acc) ? acc : 0));
  if(distanciaAjustada > cfg.raio_metros){
    return {ok:false, exigido:true, config:cfg, distancia_metros:Math.round(dist), distancia_ajustada_metros:Math.round(distanciaAjustada), precisao_metros:acc||null, error:'A transmissão está restrita a ouvintes presentes no local do evento.'};
  }
  return {ok:true, exigido:true, config:cfg, distancia_metros:Math.round(dist), distancia_ajustada_metros:Math.round(distanciaAjustada), precisao_metros:acc||null};
}
function indicePorCabecalho(headers, nomes){
  const alvos = nomes.map(normalizarCabecalhoPlanilha);
  for(let i=0;i<headers.length;i++){
    const h = normalizarCabecalhoPlanilha(headers[i]);
    if(alvos.includes(h)) return i;
  }
  for(let i=0;i<headers.length;i++){
    const h = normalizarCabecalhoPlanilha(headers[i]);
    if(alvos.some(a => h.includes(a) || a.includes(h))) return i;
  }
  return -1;
}
function valorLinhaPorIndices(row, indices){
  for(const idx of indices){
    if(idx >= 0 && row[idx] !== undefined && String(row[idx]).trim()) return String(row[idx]).trim();
  }
  return '';
}

function uuidEstavelParaSalaLegada(valor){
  const hex = crypto.createHash('sha256').update(String(valor || '')).digest('hex').slice(0, 32).split('');
  // UUID v5-like determinístico: mesma sala sempre produz o mesmo UUID válido.
  hex[12] = '5';
  hex[16] = ['8','9','a','b'][parseInt(hex[16], 16) % 4];
  const h = hex.join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

async function buscarSalaNaPlanilha(sala, password){
  const codigo = normalizarCodigoSalaBusca(sala);
  if(!codigo) return null;
  try{
    const sheets = await getSheets();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A:Z`
    });
    const rows = resp.data && resp.data.values ? resp.data.values : [];
    if(!rows.length) return null;

    const headers = rows[0] || [];
    const idxSala = indicePorCabecalho(headers, [
      'sala','codigo_sala','codigo da sala','código da sala','sala_codigo','codigo','código','room','room_code','roomcode'
    ]);
    const idxSenha = indicePorCabecalho(headers, [
      'senha','senha_transmissor','senha do transmissor','senha de transmissor','password','transmitter_password'
    ]);
    const idxTitulo = indicePorCabecalho(headers, [
      'evento','titulo','título','nome_evento','nome do evento','titulo_publicado','title'
    ]);
    const idxMax = indicePorCabecalho(headers, [
      'max_ouvintes','max ouvintes','numero_maximo_ouvintes','número máximo de ouvintes','ouvintes','maximo ouvintes'
    ]);
    const idxDuracao = indicePorCabecalho(headers, [
      'duracao','duração','duracao_horas','duração horas','horas','duration'
    ]);
    const idxData = indicePorCabecalho(headers, [
      'data','data_evento','data e hora','inicio','início','start','start_time'
    ]);
    const idxStatus = indicePorCabecalho(headers, [
      'status','ativo','liberado','publicado','status_operacao','status_publicacao'
    ]);

    const linhas = rows.slice(1);
    const possivelCabecalho = headers.some(h => normalizarCabecalhoPlanilha(h).includes('sala') || normalizarCabecalhoPlanilha(h).includes('senha'));
    const linhasParaBuscar = possivelCabecalho ? linhas : rows;

    for(let i=0;i<linhasParaBuscar.length;i++){
      const row = linhasParaBuscar[i] || [];
      let indiceSalaEncontrada = -1;
      let salaPlanilha = '';

      if(idxSala >= 0 && celulaIgualCodigo(row[idxSala], codigo)){
        indiceSalaEncontrada = idxSala;
        salaPlanilha = String(row[idxSala] || '').trim();
      }else{
        for(let c=0;c<row.length;c++){
          if(celulaIgualCodigo(row[c], codigo)){
            indiceSalaEncontrada = c;
            salaPlanilha = String(row[c] || '').trim();
            break;
          }
        }
      }
      if(indiceSalaEncontrada < 0 || !salaPlanilha) continue;

      const statusPlanilha = idxStatus >= 0 ? String(row[idxStatus] || '').trim().toLowerCase() : '';
      // Se houver uma coluna de status reconhecida, bloqueia apenas status claramente negativos.
      if(statusPlanilha && ['cancelado','cancelada','inativo','inativa','bloqueado','bloqueada','encerrado','encerrada','negado','negada'].includes(statusPlanilha)){
        continue;
      }

      let senha = valorLinhaPorIndices(row, [idxSenha, 0]);
      // Compatibilidade com planilhas antigas: quando a sala está em B, a senha costuma estar em A; quando a sala estiver em outra coluna, tenta a célula anterior.
      if(!senha && indiceSalaEncontrada > 0) senha = String(row[indiceSalaEncontrada - 1] || '').trim();
      if(!senha && password){
        const senhaEncontradaNaLinha = row.find(c => celulaIgualCodigo(c, password));
        if(senhaEncontradaNaLinha) senha = String(senhaEncontradaNaLinha).trim();
      }

      return {
        id: uuidEstavelParaSalaLegada(`google-sheets:${salaPlanilha}`),
        id_legado: `planilha-${i+1}`,
        origem: 'google_sheets',
        titulo_original: valorLinhaPorIndices(row, [idxTitulo, 2]) || 'Evento Audesc',
        titulo_publicado: valorLinhaPorIndices(row, [idxTitulo, 2]) || 'Evento Audesc',
        sala_codigo: salaPlanilha,
        senha_transmissor: senha,
        status_operacao: 'liberado',
        status_publicacao: 'aprovado',
        max_ouvintes: Number(valorLinhaPorIndices(row, [idxMax, 3]) || 0) || null,
        duracao_horas: Number(valorLinhaPorIndices(row, [idxDuracao, 4]) || 0) || null,
        data_evento: valorLinhaPorIndices(row, [idxData, 5]) || null,
        exigir_gps_ouvintes: false,
        gps_raio_metros: null,
        gps_precisao_max_metros: null,
        latitude: null,
        longitude: null
      };
    }
  }catch(e){
    console.warn('Fallback Google Sheets para sala falhou:', e && e.message ? e.message : e);
  }
  return null;
}

async function buscarDemonstracaoPorSala(sb, sala){
  const codigo = normalizarCodigoSalaBusca(sala);
  if(!codigo) return null;
  const {data,error}=await sb.from('salas_demonstracao').select('*').ilike('sala_codigo',codigo).limit(1);
  if(error) throw error;
  if(!data || !data.length) return null;
  const d=data[0];
  return {id:d.id,tipo_sala:'demonstracao',origem:'demonstracao',titulo_original:d.nome||'Sala de Demonstração Audesc',titulo_publicado:d.nome||'Sala de Demonstração Audesc',sala_codigo:d.sala_codigo,senha_transmissor:d.senha_transmissor,status_operacao:(d.ativa&&!d.bloqueada&&new Date(d.expira_em)>new Date())?'liberado':'nao_liberado',status_publicacao:'aprovado',max_ouvintes:d.limite_ouvintes,duracao_horas:Number(d.duracao_sessao_minutos||0)/60,data_evento:d.sessao_atual_iniciada_em,margem_transmissao_minutos:0,demonstracao:d};
}
async function buscarEventoOuPlanilhaPorSala(sb, sala, campos, opts){
  const ev = await buscarEventoPorSala(sb, sala, campos);
  if(ev) return ev;
  const demo = await buscarDemonstracaoPorSala(sb, sala);
  if(demo) return demo;
  return await buscarSalaNaPlanilha(sala, opts && opts.password);
}
async function iniciarSessaoDemonstracao(sb, ev){
  if(!ev||ev.tipo_sala!=='demonstracao'||!ev.demonstracao) return ev;
  let d=ev.demonstracao; const agora=new Date();
  if(!d.ativa||d.bloqueada) throw new Error('Esta sala de demonstração está bloqueada ou inativa.');
  if(new Date(d.expira_em)<=agora) throw new Error('A validade desta sala de demonstração terminou.');
  const inicio=d.sessao_atual_iniciada_em?new Date(d.sessao_atual_iniciada_em):null;
  const fimPrevisto=inicio?new Date(inicio.getTime()+Number(d.duracao_sessao_minutos)*60000):null;
  const sessaoAtiva=inicio&&!d.sessao_atual_encerrada_em&&fimPrevisto>agora;
  if(!sessaoAtiva){
    if(Number(d.sessoes_utilizadas||0)>=Number(d.limite_sessoes||0)) throw new Error('O número máximo de sessões desta demonstração foi atingido.');
    const novoInicio=agora.toISOString();
    const {data,error}=await sb.from('salas_demonstracao').update({sessoes_utilizadas:Number(d.sessoes_utilizadas||0)+1,sessao_atual_iniciada_em:novoInicio,sessao_atual_encerrada_em:null,updated_at:novoInicio}).eq('id',d.id).select('*').single();
    if(error) throw error; d=data;
  }
  ev.demonstracao=d; ev.data_evento=d.sessao_atual_iniciada_em; ev.duracao_horas=Number(d.duracao_sessao_minutos||0)/60; ev.max_ouvintes=d.limite_ouvintes; return ev;
}

function senhaAdminValida(password){
  const senha = String(password || '').trim();
  const senhasAdmin = [process.env.ADMIN_TRANSMITTER_PASSWORD, ADMIN_TOKEN].filter(Boolean).map(v => String(v).trim()).filter(Boolean);
  return !!senha && senhasAdmin.includes(senha);
}

function normalizarRoleToken(role){
  const r = String(role || '').toLowerCase();
  if(['transmitter','transmissor','publisher'].includes(r)) return 'transmitter';
  return 'receiver';
}
function normalizarIdentityToken(identity, role){
  const fallback = role === 'transmitter' ? 'Transmissor' : 'Ouvinte';
  return limit(identity || fallback, 80) || fallback;
}
function gerarLiveKitToken({room, identity, role}){
  const apiKey = process.env.LIVEKIT_API_KEY || process.env.LIVEKIT_KEY || '';
  const apiSecret = process.env.LIVEKIT_API_SECRET || process.env.LIVEKIT_SECRET || '';
  if(!apiKey || !apiSecret){
    throw new Error('Credenciais do LiveKit não configuradas no audesc-events-api. Configure LIVEKIT_API_KEY e LIVEKIT_API_SECRET no Render.');
  }
  const agora = Math.floor(Date.now() / 1000);
  const canPublish = role === 'transmitter';
  const payload = {
    iss: apiKey,
    sub: identity,
    nbf: agora - 10,
    exp: agora + 6 * 60 * 60,
    video: {
      roomJoin: true,
      room,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true
    }
  };
  return assinarJwtHs256(payload, apiSecret);
}

function admin(req,res){ const t=req.headers['x-admin-token']||req.query.admin_token; if(!ADMIN_TOKEN || t!==ADMIN_TOKEN){res.status(403).json({error:'Acesso administrativo não autorizado.'}); return false;} return true; }



function normalizarBuscaLocal(v){
  return String(v||'')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[\u2019']/g,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}
function normalizarChaveLocal(v){ return normalizarBuscaLocal(v).replace(/\s+/g,''); }
function carregarAliasesLocalizacao(){
  const basico={
    countries:{
      BR:['Brasil','Brazil'],PT:['Portugal'],AO:['Angola'],MZ:['Moçambique','Mocambique','Mozambique'],CV:['Cabo Verde','Cape Verde'],GW:['Guiné-Bissau','Guine-Bissau','Guinea-Bissau'],GQ:['Guiné Equatorial','Guine Equatorial','Equatorial Guinea'],ST:['São Tomé e Príncipe','Sao Tome e Principe','São Tomé and Príncipe','Sao Tome and Principe'],TL:['Timor-Leste','Timor Leste','East Timor']
    },
    units:{
      BR:{
        AC:['Acre'],AL:['Alagoas'],AP:['Amapá','Amapa'],AM:['Amazonas'],BA:['Bahia'],CE:['Ceará','Ceara'],DF:['Distrito Federal','Brasília','Brasilia','Taguatinga'],ES:['Espírito Santo','Espirito Santo'],GO:['Goiás','Goias'],MA:['Maranhão','Maranhao'],MT:['Mato Grosso'],MS:['Mato Grosso do Sul'],MG:['Minas Gerais'],PA:['Pará','Para'],PB:['Paraíba','Paraiba'],PR:['Paraná','Parana'],PE:['Pernambuco'],PI:['Piauí','Piaui'],RJ:['Rio de Janeiro'],RN:['Rio Grande do Norte'],RS:['Rio Grande do Sul'],RO:['Rondônia','Rondonia'],RR:['Roraima'],SC:['Santa Catarina'],SP:['São Paulo','Sao Paulo'],SE:['Sergipe'],TO:['Tocantins']
      },
      PT:{LIS:['Lisboa','Lisbon'],POR:['Porto','Oporto'],AVE:['Aveiro'],BEJ:['Beja'],BRA:['Braga'],BGC:['Bragança','Braganca'],CTB:['Castelo Branco'],CBR:['Coimbra'],EVR:['Évora','Evora'],FAR:['Faro'],GUA:['Guarda'],LEI:['Leiria'],PTG:['Portalegre'],STR:['Santarém','Santarem'],SET:['Setúbal','Setubal'],VCT:['Viana do Castelo'],VRL:['Vila Real'],VIS:['Viseu'],ACO:['Açores','Azores'],MAD:['Madeira']},
      AO:{LUA:['Luanda'],BGO:['Bengo'],BGU:['Benguela'],BIE:['Bié','Bie'],CAB:['Cabinda'],CCU:['Cuando Cubango'],CNO:['Cuanza Norte','Kwanza Norte'],CUS:['Cuanza Sul','Kwanza Sul'],CNN:['Cunene'],HUA:['Huambo'],HUI:['Huíla','Huila'],LNO:['Lunda Norte'],LSU:['Lunda Sul'],MAL:['Malanje'],MOX:['Moxico'],NAM:['Namibe'],UIG:['Uíge','Uige'],ZAI:['Zaire']},
      MZ:{MPM:['Maputo Cidade','Maputo City','Cidade de Maputo'],MAP:['Maputo'],CD:['Cabo Delgado'],GZ:['Gaza'],IN:['Inhambane'],MN:['Manica'],NA:['Nampula'],NI:['Niassa'],SO:['Sofala'],TE:['Tete'],ZA:['Zambézia','Zambezia']},
      CV:{BV:['Boa Vista'],BR:['Brava'],FG:['Fogo'],MA:['Maio'],SL:['Sal'],ST:['Santiago'],SA:['Santo Antão','Santo Antao'],SN:['São Nicolau','Sao Nicolau'],SV:['São Vicente','Sao Vicente']},
      GW:{BA:['Bafatá','Bafata'],BI:['Biombo'],BL:['Bolama/Bijagós','Bolama Bijagos'],CA:['Cacheu'],GA:['Gabú','Gabu'],OI:['Oio'],QU:['Quinara'],TO:['Tombali'],BS:['Setor Autônomo de Bissau','Sector Autónomo de Bissau','Bissau']},
      GQ:{AN:['Annobón','Annobon'],BN:['Bioko Norte'],BS:['Bioko Sul'],CS:['Centro Sul'],DJ:['Djibloho'],KN:['Kie-Ntem'],LI:['Litoral'],WN:['Wele-Nzas']},
      ST:{AG:['Água Grande','Agua Grande'],CA:['Cantagalo'],CU:['Caué','Caue'],LE:['Lembá','Lemba'],LO:['Lobata'],MZ:['Mé-Zóchi','Me-Zochi'],PR:['Região Autônoma do Príncipe','Regiao Autonoma do Principe','Príncipe','Principe']},
      TL:{AL:['Aileu'],AN:['Ainaro'],AT:['Ataúro','Atauro'],BA:['Baucau'],BO:['Bobonaro'],CO:['Covalima'],DI:['Díli','Dili'],ER:['Ermera'],LA:['Lautém','Lautem'],LI:['Liquiçá','Liquica'],MT:['Manatuto'],MF:['Manufahi'],OE:['Oecusse','Oecussi'],VI:['Viqueque']}
    }
  };
  try{
    const file=path.join(__dirname,'data','location-aliases.json');
    if(fs.existsSync(file)){
      const extra=JSON.parse(fs.readFileSync(file,'utf8'));
      return {
        countries:{...(basico.countries||{}),...(extra.countries||{})},
        units:{...(basico.units||{}),...(extra.units||{})}
      };
    }
  }catch(e){ console.warn('Não foi possível carregar aliases de localização:', e.message); }
  return basico;
}
const LOCATION_ALIASES=carregarAliasesLocalizacao();
function codigoPaisMaps(pais){
  const alvo=normalizarChaveLocal(pais);
  if(!alvo) return '';
  for(const [codigo, nomes] of Object.entries(LOCATION_ALIASES.countries||{})){
    if(normalizarChaveLocal(codigo)===alvo || (nomes||[]).some(n=>normalizarChaveLocal(n)===alvo)) return codigo.toUpperCase();
  }
  return String(pais||'').trim().length===2 ? String(pais).trim().toUpperCase() : '';
}


const TIMEZONE_POR_PAIS = {
  BR: 'America/Sao_Paulo',
  PT: 'Europe/Lisbon',
  AO: 'Africa/Luanda',
  MZ: 'Africa/Maputo',
  CV: 'Atlantic/Cape_Verde',
  GW: 'Africa/Bissau',
  GQ: 'Africa/Malabo',
  ST: 'Africa/Sao_Tome',
  TL: 'Asia/Dili'
};
const TIMEZONE_POR_UNIDADE = {
  BR: {
    AC:'America/Rio_Branco',
    AM:'America/Manaus',
    RO:'America/Porto_Velho',
    RR:'America/Boa_Vista',
    MT:'America/Cuiaba',
    MS:'America/Campo_Grande',
    DF:'America/Sao_Paulo'
  },
  PT: { ACO:'Atlantic/Azores', MAD:'Europe/Lisbon' }
};
function timezoneValido(tz){
  try{ new Intl.DateTimeFormat('en-US',{timeZone:tz}).format(new Date()); return true; }catch(e){ return false; }
}
function timezonePorLocal(paisCodigo, unidadeCodigo, paisNome){
  const p = String(paisCodigo || codigoPaisMaps(paisNome) || '').toUpperCase();
  const u = String(unidadeCodigo || '').toUpperCase();
  const tz = (TIMEZONE_POR_UNIDADE[p] && TIMEZONE_POR_UNIDADE[p][u]) || TIMEZONE_POR_PAIS[p] || 'America/Sao_Paulo';
  return timezoneValido(tz) ? tz : 'America/Sao_Paulo';
}
function offsetTimezoneMs(date, timeZone){
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit',
    hour12:false
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const asUTC = Date.UTC(Number(parts.year), Number(parts.month)-1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUTC - date.getTime();
}
function localDateTimeToUTCISO(localValue, timeZone){
  const raw = String(localValue || '').trim();
  if(!raw) return null;
  if(/[zZ]$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw)){
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if(!m){
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const y=Number(m[1]), mo=Number(m[2]), da=Number(m[3]), h=Number(m[4]), mi=Number(m[5]), se=Number(m[6]||0);
  const tz = timezoneValido(timeZone) ? timeZone : 'America/Sao_Paulo';
  let utcMs = Date.UTC(y, mo-1, da, h, mi, se);
  for(let i=0;i<3;i++) utcMs = Date.UTC(y, mo-1, da, h, mi, se) - offsetTimezoneMs(new Date(utcMs), tz);
  return new Date(utcMs).toISOString();
}
function prepararDataEvento(valor, timezone){
  const iso = localDateTimeToUTCISO(valor, timezone);
  return iso || null;
}

function aliasesPais(codigo){ return [codigo, ...((LOCATION_ALIASES.countries||{})[codigo]||[])].filter(Boolean); }
function codigoUnidadeLocal(paisCodigo, unidade, unidadeTexto){
  const alvo=[unidade,unidadeTexto].map(normalizarChaveLocal).filter(Boolean);
  const units=(LOCATION_ALIASES.units||{})[paisCodigo]||{};
  for(const [codigo, nomes] of Object.entries(units)){
    const cand=[codigo, ...(nomes||[])].map(normalizarChaveLocal);
    if(alvo.some(a=>cand.includes(a))) return codigo.toUpperCase();
  }
  const bruto=String(unidade||unidadeTexto||'').trim();
  if(bruto && bruto.length<=6) return bruto.toUpperCase();
  return '';
}
function aliasesUnidade(paisCodigo, unidadeCodigo, unidadeTexto){
  const units=(LOCATION_ALIASES.units||{})[paisCodigo]||{};
  const nomes=[unidadeCodigo, unidadeTexto, ...(units[unidadeCodigo]||[])].filter(Boolean);
  return [...new Set(nomes.map(String))];
}
function componenteTexto(comp){ return comp?.shortText || comp?.longText || comp?.short_name || comp?.long_name || ''; }
function montarVariantesConsultaLocal(query, pais, uf, ufTexto){
  const q=text(query);
  const p=text(pais);
  const u=text(ufTexto || uf);
  const variantes=[];
  function add(v){ v=text(v); if(v && !variantes.some(x=>normalizarBuscaLocal(x)===normalizarBuscaLocal(v))) variantes.push(v); }
  if(u && p) add(`${q}, ${u}, ${p}`);
  if(uf && uf!==ufTexto && p) add(`${q}, ${uf}, ${p}`);
  if(p) add(`${q}, ${p}`);
  add(q);
  const nq=normalizarBuscaLocal(q);
  if(nq.includes('mpf')){
    const expandida=q.replace(/\bmpf\b/ig,'Ministério Público Federal');
    if(u && p) add(`${expandida}, ${u}, ${p}`);
    if(p) add(`${expandida}, ${p}`);
    add(expandida);
    if(u && p) add(`Memorial do Ministério Público Federal, ${u}, ${p}`);
    if(u && p) add(`Memorial do MPF, Brasília, ${u}, ${p}`);
    if(u && p) add(`Memorial do Ministério Público Federal, Procuradoria-Geral da República, Brasília, ${u}, ${p}`);
    if(u && p) add(`Procuradoria-Geral da República, SAF Sul Quadra 4, Brasília, ${u}, ${p}`);
    if(u && p) add(`Ministério Público Federal, SAF Sul Quadra 4, Brasília, ${u}, ${p}`);
  }
  if(nq.includes('dorina') || nq.includes('biblioteca braille')){
    if(u && p) add(`Biblioteca Braille Dorina Nowill, Taguatinga, ${u}, ${p}`);
    if(u && p) add(`Biblioteca Pública Braille Dorina Nowill, Taguatinga, ${u}, ${p}`);
    if(u && p) add(`Biblioteca Dorina Nowill, Taguatinga, Brasília, ${u}, ${p}`);
    if(p) add(`Biblioteca Braille Dorina Nowill, Taguatinga, ${p}`);
  }
  return variantes.slice(0,16);
}
function textoCorrespondeAlias(texto, aliases){
  const nt=normalizarBuscaLocal(texto);
  const kt=normalizarChaveLocal(texto);
  if(!nt) return false;
  return (aliases||[]).some(alias=>{
    const na=normalizarBuscaLocal(alias);
    const ka=normalizarChaveLocal(alias);
    return na && (nt===na || kt===ka || nt.includes(na) || na.includes(nt));
  });
}
function paisResultadoValido(textos, ctx){
  if(!ctx.codigoPais) return true;
  const aliases=aliasesPais(ctx.codigoPais);
  return textos.some(t=>String(t||'').toUpperCase()===ctx.codigoPais || textoCorrespondeAlias(t, aliases));
}
function unidadeResultadoValida(textos, ctx){
  if(!ctx.unidadeCodigo || !ctx.uf || ctx.uf==='Nacional') return true;
  const aliases=aliasesUnidade(ctx.codigoPais, ctx.unidadeCodigo, ctx.ufTexto || ctx.uf);
  return textos.some(t=>String(t||'').toUpperCase()===ctx.unidadeCodigo || textoCorrespondeAlias(t, aliases));
}
function resultadoNominatimDentro(info, ctx){
  const a=info.address||{};
  const countryTexts=[a.country_code, a.country, info.display_name];
  if(!paisResultadoValido(countryTexts,ctx)) return false;
  const unitTexts=[a.state_code, (a['ISO3166-2-lvl4']||'').split('-').pop(), a.state, a.region, a.city, a.town, a.county, info.display_name].filter(Boolean);
  if(!unidadeResultadoValida(unitTexts,ctx)) return false;
  return true;
}
function resultadoGoogleDentro(item, ctx){
  const comps=item.address_components||[];
  const c=comps.find(x=>(x.types||[]).includes('country'));
  if(!paisResultadoValido([c?.short_name,c?.long_name,item.formatted_address],ctx)) return false;
  const unitTexts=[item.formatted_address];
  for(const comp of comps){
    const tipos=comp.types||[];
    if(tipos.includes('administrative_area_level_1')||tipos.includes('administrative_area_level_2')||tipos.includes('locality')||tipos.includes('sublocality')||tipos.includes('postal_town')) unitTexts.push(comp.short_name, comp.long_name);
  }
  if(!unidadeResultadoValida(unitTexts,ctx)) return false;
  return true;
}
function resultadoGoogleNovoDentro(item, ctx){
  const comps=item.addressComponents||item.address_components||[];
  const c=comps.find(x=>(x.types||[]).includes('country'));
  if(!paisResultadoValido([componenteTexto(c), item.formattedAddress],ctx)) return false;
  const unitTexts=[item.formattedAddress];
  for(const comp of comps){
    const tipos=comp.types||[];
    if(tipos.includes('administrative_area_level_1')||tipos.includes('administrative_area_level_2')||tipos.includes('locality')||tipos.includes('sublocality')||tipos.includes('postal_town')) unitTexts.push(comp.shortText, comp.longText);
  }
  if(!unidadeResultadoValida(unitTexts,ctx)) return false;
  return true;
}
async function geocodeGooglePlacesNovo(query, ctx){
  if(!GOOGLE_MAPS_API_KEY) return null;
  const variantes=montarVariantesConsultaLocal(query, ctx.pais, ctx.uf, ctx.ufTexto);
  for(const consulta of variantes){
    const body={textQuery:consulta,languageCode:'pt-BR',maxResultCount:5};
    if(ctx.codigoPais) body.regionCode=ctx.codigoPais;
    const r=await fetch('https://places.googleapis.com/v1/places:searchText',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'X-Goog-Api-Key':GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask':'places.displayName,places.formattedAddress,places.location,places.addressComponents'
      },
      body:JSON.stringify(body)
    });
    if(!r.ok) continue;
    const j=await r.json();
    const lista=Array.isArray(j.places)?j.places:[];
    for(const item of lista){
      if(!resultadoGoogleNovoDentro(item, ctx)) continue;
      const loc=item.location||{};
      if(Number.isFinite(Number(loc.latitude)) && Number.isFinite(Number(loc.longitude))){
        return {lat:Number(loc.latitude),lon:Number(loc.longitude),nome:item.displayName?.text||consulta,endereco:item.formattedAddress||'',provedor:'google_places_new',consulta,pais_codigo:ctx.codigoPais||'',unidade_codigo:ctx.unidadeCodigo||''};
      }
    }
  }
  return null;
}
async function geocodeGoogle(query, ctx){
  if(!GOOGLE_MAPS_API_KEY) return null;
  const viaPlaces=await geocodeGooglePlacesNovo(query, ctx);
  if(viaPlaces) return viaPlaces;
  const variantes=montarVariantesConsultaLocal(query, ctx.pais, ctx.uf, ctx.ufTexto);
  const candidates=[];
  for(const consulta of variantes){
    const comps=[];
    if(ctx.codigoPais) comps.push('country:'+ctx.codigoPais);
    if(ctx.unidadeCodigo && ctx.uf && ctx.uf!=='Nacional') comps.push('administrative_area:'+(ctx.ufTexto || ctx.uf));
    const geocodeUrl='https://maps.googleapis.com/maps/api/geocode/json?address='+encodeURIComponent(consulta)+'&language=pt-BR'+(comps.length?'&components='+encodeURIComponent(comps.join('|')):'')+'&key='+encodeURIComponent(GOOGLE_MAPS_API_KEY);
    const gr=await fetch(geocodeUrl);
    if(gr.ok){
      const gj=await gr.json();
      const lista=Array.isArray(gj.results)?gj.results:[];
      for(const item of lista.slice(0,5)){
        if(!resultadoGoogleDentro(item, ctx)) continue;
        const loc=item.geometry?.location;
        if(loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng))) candidates.push({lat:Number(loc.lat),lon:Number(loc.lng),nome:item.formatted_address||consulta,endereco:item.formatted_address||'',provedor:'google_geocoding',consulta,pais_codigo:ctx.codigoPais||'',unidade_codigo:ctx.unidadeCodigo||''});
      }
    }
    if(candidates.length) return candidates[0];
  }
  return null;
}
async function geocodeNominatim(query, ctx){
  const variantes=montarVariantesConsultaLocal(query, ctx.pais, ctx.uf, ctx.ufTexto);
  for(const consulta of variantes){
    let url='https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=10&accept-language=pt-BR&q='+encodeURIComponent(consulta);
    if(ctx.codigoPais) url+='&countrycodes='+encodeURIComponent(ctx.codigoPais.toLowerCase());
    const r=await fetch(url, {headers:{'User-Agent':'Audesc/1.0'}});
    if(!r.ok) continue;
    const lista=await r.json();
    const valido=(Array.isArray(lista)?lista:[]).find(item=>resultadoNominatimDentro(item,ctx));
    if(valido) return {lat:Number(valido.lat),lon:Number(valido.lon),nome:valido.name||'',endereco:valido.display_name||'',provedor:'nominatim',consulta,pais_codigo:ctx.codigoPais||'',unidade_codigo:ctx.unidadeCodigo||''};
  }
  return null;
}


function componenteEnderecoPlace(item, tipo){
  const comps=Array.isArray(item?.addressComponents)?item.addressComponents:[];
  return comps.find(c=>Array.isArray(c.types)&&c.types.includes(tipo)) || null;
}
function metadadosGooglePlace(item){
  const pais=componenteEnderecoPlace(item,'country');
  const unidade=componenteEnderecoPlace(item,'administrative_area_level_1');
  const cidade=componenteEnderecoPlace(item,'locality') || componenteEnderecoPlace(item,'administrative_area_level_2');
  return {
    pais_nome:String(pais?.longText||'').trim(),
    pais_codigo:String(pais?.shortText||'').trim().toUpperCase(),
    unidade_nome:String(unidade?.longText||'').trim(),
    unidade_codigo:String(unidade?.shortText||'').trim().toUpperCase(),
    cidade:String(cidade?.longText||'').trim()
  };
}
async function detalhesGooglePlace(placeId){
  const campos='id,displayName,formattedAddress,location,addressComponents';
  const r=await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=pt-BR`,{
    headers:{'X-Goog-Api-Key':GOOGLE_MAPS_API_KEY,'X-Goog-FieldMask':campos}
  });
  if(!r.ok) return null;
  return await r.json().catch(()=>null);
}
let GOOGLE_AUTOCOMPLETE_BLOQUEADO_ATE = 0;
let GOOGLE_AUTOCOMPLETE_ULTIMO_ERRO = '';
const GOOGLE_AUTOCOMPLETE_BLOQUEIO_429_MS = 60 * 60 * 1000;

async function previsoesAutocompleteGoogle(query, codigoPais){
  if(Date.now()<GOOGLE_AUTOCOMPLETE_BLOQUEADO_ATE){
    return {resultados:[],indisponivel:true,motivo:'quota_google',status:429};
  }
  const body={input:query,languageCode:'pt-BR'};
  if(codigoPais) body.includedRegionCodes=[String(codigoPais).toLowerCase()];
  const r=await fetch('https://places.googleapis.com/v1/places:autocomplete',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'X-Goog-Api-Key':GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask':'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text'
    },
    body:JSON.stringify(body)
  });
  if(!r.ok){
    const detalhe=await r.text().catch(()=>'');
    GOOGLE_AUTOCOMPLETE_ULTIMO_ERRO=detalhe.slice(0,500);
    console.warn('Google Places Autocomplete recusou a consulta:',r.status,detalhe.slice(0,300));
    if(r.status===429){
      GOOGLE_AUTOCOMPLETE_BLOQUEADO_ATE=Date.now()+GOOGLE_AUTOCOMPLETE_BLOQUEIO_429_MS;
      return {resultados:[],indisponivel:true,motivo:'quota_google',status:429};
    }
    return {resultados:[],indisponivel:true,motivo:'erro_google',status:r.status};
  }
  GOOGLE_AUTOCOMPLETE_BLOQUEADO_ATE=0;
  GOOGLE_AUTOCOMPLETE_ULTIMO_ERRO='';
  const j=await r.json().catch(()=>({}));
  return {resultados:(Array.isArray(j.suggestions)?j.suggestions:[]).map(x=>x.placePrediction).filter(Boolean),indisponivel:false,status:200};
}
const CACHE_SUGESTOES_LOCAIS = new Map();
const CACHE_SUGESTOES_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_SUGESTOES_VAZIO_TTL_MS = 30 * 1000;
function chaveCacheSugestoes(query,ctx){
  return [normalizarBuscaLocal(query),String(ctx.codigoPais||'').toUpperCase(),String(ctx.unidadeCodigo||'').toUpperCase()].join('|');
}
function lerCacheSugestoes(chave){
  const item=CACHE_SUGESTOES_LOCAIS.get(chave);
  if(!item) return null;
  if(item.expiraEm<Date.now()){CACHE_SUGESTOES_LOCAIS.delete(chave);return null;}
  return item.resultados;
}
function gravarCacheSugestoes(chave,resultados,ttlMs=CACHE_SUGESTOES_TTL_MS){
  CACHE_SUGESTOES_LOCAIS.set(chave,{expiraEm:Date.now()+ttlMs,resultados});
  if(CACHE_SUGESTOES_LOCAIS.size>500){
    const primeira=CACHE_SUGESTOES_LOCAIS.keys().next().value;
    CACHE_SUGESTOES_LOCAIS.delete(primeira);
  }
}
function normalizarLocalConhecido(v){return normalizarBuscaLocal(v).replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();}
function localConhecidoParaSugestao(item){
  return {
    id:'audesc-'+item.id,
    local_id:item.id,
    place_id:item.google_place_id||'',
    nome:item.nome||'',
    endereco:item.endereco||'',
    texto_completo:[item.nome,item.endereco&&item.endereco!==item.nome?item.endereco:''].filter(Boolean).join(' — '),
    lat:Number(item.latitude),lon:Number(item.longitude),provedor:'audesc',
    pais_nome:item.pais_nome||'',pais_codigo:item.pais_codigo||'',
    unidade_nome:item.unidade_nome||'',unidade_codigo:item.unidade_codigo||'',cidade:item.cidade||''
  };
}
async function buscarLocaisConhecidos(query,ctx){
  const termo=normalizarLocalConhecido(query);
  if(!termo) return [];
  let q=getSupabase().from('locais_conhecidos')
    .select('id,google_place_id,nome,endereco,pais_nome,pais_codigo,unidade_nome,unidade_codigo,cidade,latitude,longitude,quantidade_usos,ultimo_uso_em')
    .eq('ativo',true).ilike('texto_busca',`%${termo}%`).limit(30);
  if(ctx.codigoPais) q=q.eq('pais_codigo',ctx.codigoPais);
  const {data,error}=await q;
  if(error){console.warn('Diretório interno de locais indisponível:',error.message||error);return [];}
  const unidade=String(ctx.unidadeCodigo||'').toUpperCase();
  return (data||[]).filter(x=>Number.isFinite(Number(x.latitude))&&Number.isFinite(Number(x.longitude)))
    .sort((a,b)=>{
      const au=unidade&&String(a.unidade_codigo||'').toUpperCase()===unidade?1:0;
      const bu=unidade&&String(b.unidade_codigo||'').toUpperCase()===unidade?1:0;
      return bu-au || Number(b.quantidade_usos||0)-Number(a.quantidade_usos||0) || String(b.ultimo_uso_em||'').localeCompare(String(a.ultimo_uso_em||''));
    }).slice(0,5).map(localConhecidoParaSugestao);
}
async function registrarLocalConhecido(item){
  const nome=limit(item?.nome,200), endereco=limit(item?.endereco,500);
  const latitude=numeroCoordenada(item?.lat??item?.latitude), longitude=numeroCoordenada(item?.lon??item?.longitude);
  if(!nome||latitude===null||longitude===null) return null;
  const googlePlaceId=limit(item?.place_id||item?.google_place_id,255);
  const textoBusca=normalizarLocalConhecido([nome,endereco,item?.cidade,item?.unidade_nome,item?.pais_nome].filter(Boolean).join(' '));
  const payload={google_place_id:googlePlaceId||null,nome,endereco,texto_busca:textoBusca,
    pais_nome:limit(item?.pais_nome,120),pais_codigo:limit(item?.pais_codigo,10).toUpperCase(),
    unidade_nome:limit(item?.unidade_nome,120),unidade_codigo:limit(item?.unidade_codigo,30).toUpperCase(),cidade:limit(item?.cidade,120),
    latitude,longitude,fonte:limit(item?.provedor||'usuario',40),ultimo_uso_em:new Date().toISOString(),ativo:true};
  let existente=null;
  if(googlePlaceId){
    const r=await getSupabase().from('locais_conhecidos').select('id,quantidade_usos').eq('google_place_id',googlePlaceId).maybeSingle();
    if(!r.error) existente=r.data;
  }
  if(!existente){
    const r=await getSupabase().from('locais_conhecidos').select('id,quantidade_usos').eq('pais_codigo',payload.pais_codigo).eq('texto_busca',textoBusca).limit(1);
    if(!r.error) existente=(r.data||[])[0]||null;
  }
  if(existente){
    payload.quantidade_usos=Number(existente.quantidade_usos||0)+1;
    const {data,error}=await getSupabase().from('locais_conhecidos').update(payload).eq('id',existente.id).select().single();
    if(error) throw error; return data;
  }
  payload.quantidade_usos=1;
  const {data,error}=await getSupabase().from('locais_conhecidos').insert(payload).select().single();
  if(error) throw error; return data;
}
async function sugerirGooglePlaces(query, ctx){
  if(!GOOGLE_MAPS_API_KEY) return {resultados:[],indisponivel:true,motivo:'chave_google_ausente'};
  // Uma única chamada de autocomplete. Os detalhes são buscados apenas após a seleção.
  const resposta=await previsoesAutocompleteGoogle(query,ctx.codigoPais||'');
  const previsoes=Array.isArray(resposta?.resultados)?resposta.resultados:[];
  const vistos=new Set(), resultados=[];
  for(const previsao of previsoes){
    const placeId=String(previsao.placeId||'').trim();
    if(!placeId||vistos.has(placeId)) continue;
    vistos.add(placeId);
    const nome=String(previsao.structuredFormat?.mainText?.text||previsao.text?.text||query).trim();
    const endereco=String(previsao.structuredFormat?.secondaryText?.text||'').trim();
    resultados.push({id:placeId,place_id:placeId,nome,endereco,texto_completo:[nome,endereco].filter(Boolean).join(' — '),provedor:'google_places_autocomplete',precisa_detalhes:true});
    if(resultados.length>=5) break;
  }
  return {resultados,indisponivel:Boolean(resposta?.indisponivel),motivo:resposta?.motivo||'',status:resposta?.status||200};
}

let ULTIMA_CHAMADA_NOMINATIM_EM = 0;
async function aguardarNominatim(){
  const espera=Math.max(0,1000-(Date.now()-ULTIMA_CHAMADA_NOMINATIM_EM));
  if(espera) await new Promise(resolve=>setTimeout(resolve,espera));
  ULTIMA_CHAMADA_NOMINATIM_EM=Date.now();
}

async function sugerirNominatimLocais(query, ctx){
  const consulta=montarVariantesConsultaLocal(query,ctx.pais,ctx.uf,ctx.ufTexto)[0]||query;
  let url='https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&accept-language=pt-BR&q='+encodeURIComponent(consulta);
  if(ctx.codigoPais) url+='&countrycodes='+encodeURIComponent(ctx.codigoPais.toLowerCase());
  await aguardarNominatim();
  const r=await fetch(url,{headers:{'User-Agent':'Audesc/1.0 (contato: suporte@audesc.com)'}});
  if(!r.ok){
    console.warn('Nominatim recusou a consulta:',r.status);
    return {resultados:[],indisponivel:true,status:r.status};
  }
  const lista=await r.json().catch(()=>[]);
  const resultados=[], vistos=new Set();
  for(const item of Array.isArray(lista)?lista:[]){
    if(!resultadoNominatimDentro(item,ctx)) continue;
    const lat=Number(item.lat), lon=Number(item.lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)) continue;
    const chave=String(item.place_id||item.osm_id||item.display_name||'');
    if(!chave||vistos.has(chave)) continue;
    vistos.add(chave);
    const a=item.address||{};
    const paisCodigo=String(a.country_code||ctx.codigoPais||'').toUpperCase();
    const unidadeCodigo=String(a.state_code||(a['ISO3166-2-lvl4']||'').split('-').pop()||ctx.unidadeCodigo||'').toUpperCase();
    const nome=String(item.name||item.display_name||consulta).trim();
    const endereco=String(item.display_name||nome).trim();
    resultados.push({
      id:'nominatim-'+chave,place_id:'',nome,endereco,
      texto_completo:[nome,endereco&&endereco!==nome?endereco:''].filter(Boolean).join(' — '),
      lat,lon,provedor:'nominatim',pais_nome:String(a.country||ctx.pais||'').trim(),pais_codigo:paisCodigo,
      unidade_nome:String(a.state||a.region||ctx.ufTexto||ctx.uf||'').trim(),unidade_codigo:unidadeCodigo,
      cidade:String(a.city||a.town||a.village||a.municipality||a.county||'').trim()
    });
    if(resultados.length>=5) break;
  }
  return {resultados,indisponivel:false,status:200};
}



app.get('/localizacao-aproximada', async (req,res)=>{
  const ip=ipCliente(req);
  if(ipPrivadoOuLocal(ip)) return res.status(503).json({ok:false,error:'Não foi possível identificar a localização aproximada deste acesso.'});
  limparCacheLocalizacaoIp();
  const chave=crypto.createHash('sha256').update(ip).digest('hex');
  const salvo=cacheLocalizacaoIp.get(chave);
  if(salvo && salvo.expiraEm>Date.now()) return res.json({ok:true,localizacao:salvo.localizacao,fonte:'cache'});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),4500);
  try{
    const url='https://ipapi.co/'+encodeURIComponent(ip)+'/json/';
    const resposta=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Audesc/21.7.0'},signal:controller.signal});
    const dados=await resposta.json().catch(()=>({}));
    if(!resposta.ok || dados.error) throw new Error(dados.reason||dados.message||('HTTP '+resposta.status));
    const paisCodigo=String(dados.country_code||'').toUpperCase();
    const unidadeCodigo=String(dados.region_code||'').toUpperCase();
    if(!paisCodigo) throw new Error('País não identificado.');
    const localizacao={
      pais_codigo:paisCodigo,
      pais_nome:String(dados.country_name||''),
      unidade_codigo:unidadeCodigo,
      unidade_nome:String(dados.region||''),
      fonte:'ip',
      aproximada:true
    };
    cacheLocalizacaoIp.set(chave,{localizacao,expiraEm:Date.now()+CACHE_LOCALIZACAO_IP_TTL_MS});
    return res.json({ok:true,localizacao,fonte:'ip'});
  }catch(e){
    console.warn('Localização aproximada por IP indisponível:',e.message||e);
    return res.status(503).json({ok:false,error:'Localização aproximada temporariamente indisponível.'});
  }finally{clearTimeout(timer);}
});
app.get('/geocode/sugestoes', async (req,res)=>{
  try{
    const query=limit(req.query.q,300);
    if(!query || query.length<3) return res.json({ok:true,resultados:[]});
    const pais=limit(req.query.pais,80);
    const uf=limit(req.query.uf,40);
    const ufTexto=limit(req.query.ufTexto,120);
    const codigoPaisInformado=limit(req.query.paisCodigo,10);
    const codigoUnidadeInformado=limit(req.query.unidadeCodigo,20);
    const codigoPais=(codigoPaisInformado || codigoPaisMaps(pais)).toUpperCase();
    const unidadeCodigo=(codigoUnidadeInformado || codigoUnidadeLocal(codigoPais,uf,ufTexto)).toUpperCase();
    const ctx={pais,uf,ufTexto,codigoPais,unidadeCodigo};
    const chave=chaveCacheSugestoes(query,ctx);
    const emCache=lerCacheSugestoes(chave);
    if(emCache) return res.json({ok:true,resultados:emCache,fonte:'cache'});
    const internos=await buscarLocaisConhecidos(query,ctx);
    let externos=[];
    let googleIndisponivel=false;
    let fallbackIndisponivel=false;
    let motivo='';
    if(internos.length<5){
      try{
        const respostaGoogle=await sugerirGooglePlaces(query,ctx);
        externos=Array.isArray(respostaGoogle?.resultados)?respostaGoogle.resultados:[];
        googleIndisponivel=Boolean(respostaGoogle?.indisponivel);
        motivo=respostaGoogle?.motivo||'';
      }catch(erroGoogle){
        googleIndisponivel=true;motivo='erro_google';
        console.warn('Falha no Google Places Autocomplete:',erroGoogle?.message||erroGoogle);
      }
      if(!externos.length && internos.length<5){
        const respostaNominatim=await sugerirNominatimLocais(query,ctx).catch(e=>({resultados:[],indisponivel:true,erro:e}));
        fallbackIndisponivel=Boolean(respostaNominatim?.indisponivel);
        externos=Array.isArray(respostaNominatim?.resultados)?respostaNominatim.resultados:[];
      }
    }
    const vistos=new Set(), resultados=[];
    for(const item of [...internos,...externos]){
      const chaveItem=String(item.place_id||item.local_id||item.texto_completo||item.id||'');
      if(!chaveItem||vistos.has(chaveItem)) continue;
      vistos.add(chaveItem);resultados.push(item);if(resultados.length>=5) break;
    }
    // Resultados válidos podem ficar seis horas em cache. Falhas ou listas vazias ficam, no máximo, 30 segundos.
    if(resultados.length) gravarCacheSugestoes(chave,resultados);
    else if(!googleIndisponivel && !fallbackIndisponivel) gravarCacheSugestoes(chave,[],CACHE_SUGESTOES_VAZIO_TTL_MS);
    const indisponivelTemporariamente=!resultados.length && googleIndisponivel && fallbackIndisponivel;
    return res.json({
      ok:true,resultados,
      fonte:internos.length?'diretorio_e_externo':'externo',
      indisponivel_temporariamente:indisponivelTemporariamente,
      google_indisponivel:googleIndisponivel,
      motivo:motivo||undefined
    });
  }catch(e){
    console.error('Erro ao sugerir locais:',e);
    return res.status(500).json({error:'Erro ao buscar sugestões de locais.'});
  }
});

app.get('/geocode/detalhes', async (req,res)=>{
  try{
    const placeId=limit(req.query.place_id,255);
    if(!placeId) return res.status(400).json({error:'Identificador do local não informado.'});
    const item=await detalhesGooglePlace(placeId);
    if(!item) return res.status(404).json({error:'Não foi possível obter os detalhes do local.'});
    const loc=item.location||{}, lat=Number(loc.latitude), lon=Number(loc.longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)) return res.status(404).json({error:'O local não possui coordenadas disponíveis.'});
    const meta=metadadosGooglePlace(item);
    const nome=String(item.displayName?.text||'').trim(), endereco=String(item.formattedAddress||'').trim();
    return res.json({ok:true,resultado:{id:placeId,place_id:placeId,nome,endereco,texto_completo:[nome,endereco&&endereco!==nome?endereco:''].filter(Boolean).join(' — '),lat,lon,provedor:'google_places_details',...meta}});
  }catch(e){console.error('Erro ao detalhar local:',e);return res.status(500).json({error:'Erro ao obter detalhes do local.'});}
});
app.post('/geocode/locais-conhecidos', async (req,res)=>{
  try{
    const user=await getUser(req);
    if(!user) return res.status(401).json({error:'Autenticação necessária para registrar o local.'});
    const data=await registrarLocalConhecido(req.body||{});
    CACHE_SUGESTOES_LOCAIS.clear();
    return res.json({ok:true,local:data});
  }catch(e){console.error('Erro ao registrar local conhecido:',e);return res.status(500).json({error:'Não foi possível registrar o local selecionado.'});}
});

app.get('/geocode', async (req,res)=>{
  try{
    const query=limit(req.query.q,300);
    if(!query) return res.status(400).json({error:'Informe o nome ou endereço do local.'});
    const pais=limit(req.query.pais,80);
    const uf=limit(req.query.uf,40);
    const ufTexto=limit(req.query.ufTexto,120);
    const codigoPaisInformado=limit(req.query.paisCodigo,10);
    const codigoUnidadeInformado=limit(req.query.unidadeCodigo,20);
    const codigoPais=(codigoPaisInformado || codigoPaisMaps(pais)).toUpperCase();
    const unidadeCodigo=(codigoUnidadeInformado || codigoUnidadeLocal(codigoPais, uf, ufTexto)).toUpperCase();
    const ctx={pais,uf,ufTexto,codigoPais,unidadeCodigo};
    let resultado=await geocodeGoogle(query,ctx);
    if(!resultado) resultado=await geocodeNominatim(query,ctx);
    if(!resultado){
      return res.status(404).json({error:'Local não encontrado na região selecionada. Tente informar também bairro, cidade ou endereço completo.'});
    }
    return res.json({ok:true,resultado});
  }catch(e){
    console.error('Erro no geocode:', e);
    return res.status(500).json({error:'Erro ao buscar coordenadas do local.'});
  }
});

app.get('/health',(req,res)=>res.json({ok:true,service:'audesc-events-api',version:'21.7.0-fase-6.12-moeda-plataforma-automaticas' }));


const SERVICOS_COM_AGENDA = SERVICOS_CONFIG.filter(s => s.ativo !== false && s.requerAgenda).map(s => s.codigo);
function requerAgendaProfissional(ev){
  return eventoRequerAgenda(ev);
}
function statusAgendaEvento(ev){
  if(!requerAgendaProfissional(ev)) return 'nao_aplicavel';
  return String(ev?.status_agenda || 'pendente').trim();
}
function pagamentoBloqueadoPorAgenda(ev){
  return requerAgendaProfissional(ev) && statusAgendaEvento(ev) !== 'disponivel';
}
function mensagemAgenda(ev){
  const status = statusAgendaEvento(ev);
  if(status === 'indisponivel') return 'Impossibilidade do serviço - profissional indisponível.';
  if(status === 'disponivel') return 'Disponibilidade de agenda confirmada.';
  return 'Verificando disponibilidade de agenda.';
}

async function statusPagamentoInicial(ev){
  if(eventoTemDivulgacao(ev)){
    const dados = await calcularPagamentoEvento(ev, '');
    return dados.valor_final > 0 ? 'pendente' : 'dispensado';
  }
  return 'pendente';
}

async function sincronizarStatusPagamentoDivulgacao(ev){
  if(!ev || !eventoTemDivulgacao(ev)) return ev;
  if(ev.status_pagamento === 'pago') return ev;
  const statusCalculado = await statusPagamentoInicial(ev);
  if(ev.status_pagamento === statusCalculado) return ev;
  try{
    const { data, error } = await getSupabase().from('eventos').update({
      status_pagamento: statusCalculado,
      data_ultima_edicao: new Date().toISOString()
    }).eq('id', ev.id).select().single();
    if(error) throw error;
    return data || {...ev, status_pagamento: statusCalculado};
  }catch(e){
    console.warn('Não foi possível sincronizar status de pagamento da divulgação:', e.message || e);
    return {...ev, status_pagamento: statusCalculado};
  }
}

async function sincronizarListaStatusPagamentoDivulgacao(lista){
  const out=[];
  for(const ev of (lista || [])) out.push(await sincronizarStatusPagamentoDivulgacao(ev));
  return out;
}


app.post('/criar-evento', async (req,res)=>{
 try{
  const user=await getUser(req);
  if(!user) return res.status(401).json({error:'E-mail ainda não verificado. Solicite e confirme o código antes de cadastrar o evento.'});
  const b=req.body||{};
  if(text(b.website)) return res.status(400).json({error:'Solicitação inválida.'});
  if(await emailBloqueado(user.email)) return res.status(403).json({error:'Este e-mail está bloqueado para cadastro de eventos.'});
  const usuarioConfiavel = await emailConfiavel(user.email);
  const tiposServicoValidos=listarTiposServicoValidos();
  const servicos_solicitados=normalizarServicosSolicitados(b.servicos_solicitados, b.tipo_servico);
  if(!servicos_solicitados.length) return res.status(400).json({error:'Selecione pelo menos um serviço.'});
  if(servicos_solicitados.includes('audesc_transmissao') && servicos_solicitados.includes('divulgacao_gratuita')) return res.status(400).json({error:'Transmissão Audesc e Somente divulgação no Audesc não podem ser selecionados simultaneamente.'});
  const tipo_servico=tipoServicoLegado(servicos_solicitados);
  const tipo_evento=text(b.tipo_evento)==='publico'?'publico':'privado';
  const divulgar_acesso_ouvintes = tipo_evento === 'publico' && (b.divulgar_acesso_ouvintes === true || text(b.divulgar_acesso_ouvintes) === 'true');
  const duracao_horas=Math.max(1,Math.min(8,Number(b.duracao_horas||2)));
  const max_ouvintes=Math.max(10,Math.min(500,Number(b.max_ouvintes||20)));
  let paisEvento = text(b.pais)==='Outros' ? text(b.pais_outro) : text(b.pais);
  let ufEvento = text(b.pais)==='Outros' ? '' : text(b.uf);
  let modalidadeEvento=normalizarModalidadeEvento(b.modalidade_evento);
  let abrangenciaDivulgacao=normalizarAbrangenciaDivulgacao(b.abrangencia_divulgacao,modalidadeEvento);
  let paisesDivulgacao=normalizarPaisesDivulgacao(b.paises_divulgacao);
  // Compatibilidade com registros/formulários antigos.
  if(text(b.pais)==='Internacional'){paisEvento=text(b.origem_transmissao)||'Brasil';ufEvento='';modalidadeEvento='distancia';abrangenciaDivulgacao='internacional';}
  if(ufEvento==='Nacional'){ufEvento='';modalidadeEvento='distancia';abrangenciaDivulgacao='nacional';}
  if(modalidadeEvento!=='presencial'&&!abrangenciaDivulgacao) return res.status(400).json({error:'Selecione a abrangência da divulgação.'});
  if(abrangenciaDivulgacao==='internacional'&&!paisesDivulgacao.length) return res.status(400).json({error:'Selecione pelo menos um país para a divulgação internacional.'});
  if(abrangenciaDivulgacao!=='internacional') paisesDivulgacao=[];
  const origemTransmissaoEvento = '';
  const paisReferenciaTimezone = paisEvento;
  const paisCodigoEvento = limit(b.pais_codigo || b.paisCodigo || codigoPaisMaps(paisReferenciaTimezone || paisEvento),10);
  const unidadeCodigoEvento = limit(b.unidade_codigo || b.unidadeCodigo || codigoUnidadeLocal(paisCodigoEvento, ufEvento, b.ufTexto),20);
  const timezoneCalculadoEvento = timezonePorLocal(paisCodigoEvento, unidadeCodigoEvento, paisReferenciaTimezone || paisEvento);
  const timezoneEvento = timezoneValido(timezoneCalculadoEvento) ? timezoneCalculadoEvento : (timezoneValido(b.timezone) ? b.timezone : 'America/Sao_Paulo');
  const dataEventoNormalizada = prepararDataEvento(b.data_evento, timezoneEvento);
  const formularioCfg = await obterFormularioConfig();
  const localCfg = resolverFormularioConfigParaLocal(formularioCfg, paisCodigoEvento, unidadeCodigoEvento);
  if(Array.isArray(localCfg.servicosDisponiveis)){
    const indisponiveis=servicos_solicitados.filter(c=>!localCfg.servicosDisponiveis.includes(c));
    if(indisponiveis.length) return res.status(400).json({error:'Um ou mais serviços selecionados não estão disponíveis para o país e a unidade administrativa selecionados.'});
  }
  const camposCfg = localCfg.campos || {};
  const titulo = validarTextoConfigurado(b.titulo_original, 'o nome do evento', localCfg.limites?.titulo_original, true);
  const descricaoObrigatoria = !!camposCfg.descricao_original?.obrigatorio;
  const descricaoOriginal = validarTextoConfigurado(b.descricao_original, 'a descrição do evento', localCfg.limites?.descricao_original, descricaoObrigatoria);
  const categoriaCfg = camposCfg.categoria_evento || {visivel:true,obrigatorio:true};
  const categoriaEvento = categoriaCfg.visivel === false ? null : normalizarCategoriaEvento(b.categoria_evento);
  if(categoriaCfg.visivel !== false && categoriaCfg.obrigatorio && !categoriaEvento) return res.status(400).json({error:'Selecione a categoria do evento.'});
  if(categoriaCfg.visivel !== false && b.categoria_evento && !categoriaEvento) return res.status(400).json({error:'Categoria do evento inválida.'});
  const classificacaoCfg = camposCfg.classificacao_etaria || {visivel:true,obrigatorio:false};
  const classificacaoEtaria = classificacaoCfg.visivel === false ? null : normalizarClassificacaoEtaria(b.classificacao_etaria);
  if(classificacaoCfg.visivel !== false && classificacaoCfg.obrigatorio && !classificacaoEtaria) return res.status(400).json({error:'Selecione a classificação etária.'});
  if(classificacaoCfg.visivel !== false && b.classificacao_etaria && !classificacaoEtaria) return res.status(400).json({error:'Classificação etária inválida.'});
  const temTransmissao=servicos_solicitados.includes('audesc_transmissao');
  const temDivulgacao=servicos_solicitados.includes('divulgacao_gratuita');
  const temProfissional=servicos_solicitados.some(servicoRequerAgenda);
  const tipoEventoFinal=temDivulgacao?'publico':tipo_evento;
  const divulgarFinal=temDivulgacao?false:divulgar_acesso_ouvintes;
  const ev={user_id:user.id,email_usuario:user.email,tipo_servico,servicos_solicitados,tipo_evento:tipoEventoFinal,divulgar_acesso_ouvintes:divulgarFinal,status_publicacao:(tipoEventoFinal==='publico'&&!usuarioConfiavel)?'pendente':'aprovado',status_pagamento:'pendente',status_agenda:temProfissional?'pendente':'nao_aplicavel',status_operacao:'nao_liberado',titulo_original:titulo,descricao_original:descricaoOriginal,categoria_evento:categoriaEvento,classificacao_etaria:classificacaoEtaria,modalidade_evento:modalidadeEvento,abrangencia_divulgacao:abrangenciaDivulgacao,paises_divulgacao:paisesDivulgacao,site_oficial:safeUrl(b.site_oficial),link_ingressos:safeUrl(b.link_ingressos),link_inscricao:safeUrl(b.link_inscricao),link_programacao:safeUrl(b.link_programacao),link_acessibilidade:safeUrl(b.link_acessibilidade),local_evento:limit(b.local_evento,500),local_nome:limit(b.local_nome,200),local_endereco:limit(b.local_endereco,400),google_place_id:limit(b.google_place_id,255),local_pais_codigo:limit(b.local_pais_codigo,10),local_unidade_codigo:limit(b.local_unidade_codigo,30),latitude:numeroCoordenada(b.latitude),longitude:numeroCoordenada(b.longitude),pais_codigo:paisCodigoEvento,unidade_codigo:unidadeCodigoEvento,timezone:timezoneEvento,cidade:limit(b.cidade,120),pais: paisEvento,
      uf: ufEvento,
      origem_transmissao: origemTransmissaoEvento,
      data_evento:dataEventoNormalizada,duracao_horas:(temTransmissao||temProfissional)?duracao_horas:null,max_ouvintes:temTransmissao?max_ouvintes:null};
  ev.status_pagamento = await statusPagamentoInicial(ev);
  const {data,error}=await getSupabase().from('eventos').insert(ev).select().single();
  if(error) throw error;
  const email_publicacao_resultado = await notificarInscritosEventoPublicado({}, data).catch(err => {
    console.error('Falha ao notificar inscritos no cadastro do evento:', err);
    return {ok:false,error:String(err && err.message ? err.message : err)};
  });
  res.json({ok:true,mensagem:tipo_evento==='publico'?'Evento recebido e enviado para curadoria antes da publicação.':'Evento recebido.',evento:data,email_publicacao_resultado});
 }catch(e){ console.error(e); res.status(500).json({error:e.message||'Erro ao cadastrar evento.'}); }
});


async function gerarSenhaUnica(sb){
  for(let i=0;i<30;i++){
    const senha = password6();
    const { data, error } = await sb.from('eventos').select('id').eq('senha_transmissor', senha).limit(1);
    if(error) throw error;
    if(!data || data.length === 0){ const q=await sb.from('salas_demonstracao').select('id').eq('senha_transmissor',senha).limit(1); if(q.error) throw q.error; if(!q.data || q.data.length===0) return senha; }
  }
  throw new Error('Não foi possível gerar senha única.');
}

async function gerarSalaUnica(sb){
  for(let i=0;i<30;i++){
    const sala = makeRoom();
    const { data, error } = await sb.from('eventos').select('id').eq('sala_codigo', sala).limit(1);
    if(error) throw error;
    if(!data || data.length === 0){ const q=await sb.from('salas_demonstracao').select('id').eq('sala_codigo',sala).limit(1); if(q.error) throw q.error; if(!q.data || q.data.length===0) return sala; }
  }
  throw new Error('Não foi possível gerar código de sala único.');
}


function escapeEmailHtml(v){
  return String(v || '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#039;'
  }[ch]));
}

function montarEmailLiberacao(ev, senha, sala){
  const titulo = ev.titulo_publicado || ev.titulo_original || 'Evento Audesc';
  const dataEvento = ev.data_evento ? new Date(ev.data_evento).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
  const duracao = ev.duracao_horas ? `${ev.duracao_horas} hora(s)` : '';
  const maxOuvintes = ev.max_ouvintes ? `${ev.max_ouvintes} ouvinte(s)` : '';
  const subject = `Audesc: acesso liberado para ${titulo}`;

  const text = `Olá!

O acesso do seu evento foi liberado no Audesc.

Evento: ${titulo}
Código da sala: ${sala}
Senha do transmissor: ${senha}
${dataEvento ? `Data e horário: ${dataEvento}\n` : ''}${duracao ? `Duração: ${duracao}\n` : ''}${maxOuvintes ? `Máximo de ouvintes simultâneos: ${maxOuvintes}\n` : ''}

Acesse o Audesc:
${AUDESC_SITE_URL}

Instruções básicas:
1. Entre na página do Audesc.
2. Informe a senha do transmissor quando for abrir a transmissão.
3. Compartilhe com os ouvintes apenas o acesso de ouvinte, não a senha do transmissor.
4. A senha do transmissor é de uso restrito da pessoa responsável pela transmissão.

Atenciosamente,
Equipe Audesc`;

  const html = `
  <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
    <h1>Audesc: acesso liberado</h1>
    <p>Olá!</p>
    <p>O acesso do seu evento foi liberado no Audesc.</p>
    <h2>Dados do evento</h2>
    <p><strong>Evento:</strong> ${escapeEmailHtml(titulo)}</p>
    <p><strong>Código da sala:</strong> ${escapeEmailHtml(sala)}</p>
    <p><strong>Senha do transmissor:</strong> ${escapeEmailHtml(senha)}</p>
    ${dataEvento ? `<p><strong>Data e horário:</strong> ${escapeEmailHtml(dataEvento)}</p>` : ''}
    ${duracao ? `<p><strong>Duração:</strong> ${escapeEmailHtml(duracao)}</p>` : ''}
    ${maxOuvintes ? `<p><strong>Máximo de ouvintes simultâneos:</strong> ${escapeEmailHtml(maxOuvintes)}</p>` : ''}
    <p><a href="${escapeEmailHtml(AUDESC_SITE_URL)}">Acessar o Audesc</a></p>
    <h2>Instruções básicas</h2>
    <ol>
      <li>Entre na página do Audesc.</li>
      <li>Informe a senha do transmissor quando for abrir a transmissão.</li>
      <li>Compartilhe com os ouvintes apenas o acesso de ouvinte, não a senha do transmissor.</li>
      <li>A senha do transmissor é de uso restrito da pessoa responsável pela transmissão.</li>
    </ol>
    <p>Atenciosamente,<br>Equipe Audesc</p>
  </div>`;

  return { subject, text, html };
}

async function enviarEmailLiberacao(ev, senha, sala){
  if(!RESEND_API_KEY){
    console.warn('RESEND_API_KEY não configurada. E-mail não enviado.');
    return { ok:false, skipped:true, reason:'RESEND_API_KEY ausente' };
  }

  if(!ev.email_usuario){
    console.warn('Evento sem email_usuario. E-mail não enviado.');
    return { ok:false, skipped:true, reason:'email_usuario ausente' };
  }

  const conteudo = montarEmailLiberacao(ev, senha, sala);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: ev.email_usuario,
      subject: conteudo.subject,
      text: conteudo.text,
      html: conteudo.html
    })
  });

  const body = await response.json().catch(() => ({}));

  if(!response.ok){
    console.error('Erro ao enviar e-mail via Resend:', body);
    return { ok:false, status:response.status, error:body };
  }

  console.log('E-mail de liberação enviado:', body);
  return { ok:true, response:body };
}



async function registrarResultadoEmail(eventoId, resultado){
  const status = resultado && resultado.ok ? 'enviado' : (resultado && resultado.skipped ? 'nao_enviado' : 'erro');
  const erro = resultado && resultado.ok ? null : JSON.stringify(resultado || {});
  try{
    await getSupabase().from('eventos').update({
      email_liberacao_status: status,
      email_liberacao_enviado_em: resultado && resultado.ok ? new Date().toISOString() : null,
      email_liberacao_erro: erro,
      data_ultima_edicao: new Date().toISOString()
    }).eq('id', eventoId);
  }catch(e){
    console.warn('Não foi possível registrar o resultado do e-mail. Verifique as colunas no Supabase:', e.message || e);
  }
}


async function enviarEmailResend({to, subject, text: textoEmail, html, tags}){
  if(!RESEND_API_KEY) return { ok:false, skipped:true, reason:'RESEND_API_KEY ausente' };
  const destinatarios = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if(!destinatarios.length) return { ok:false, skipped:true, reason:'destinatário ausente' };
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{
      'Authorization':`Bearer ${RESEND_API_KEY}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      from:RESEND_FROM_EMAIL,
      to:destinatarios,
      subject,
      text: textoEmail,
      html,
      tags: Array.isArray(tags) ? tags : undefined
    })
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok) return { ok:false, status:response.status, error:body };
  return { ok:true, response:body };
}

async function registrarEmailEnvio({tipo, evento_id, email_destino, destinatarios, assunto, mensagem, status='enviado', erro=null, response=null}){
  try{
    const destino = email_destino ? text(email_destino).toLowerCase() : null;
    const listaDestinos = Array.isArray(destinatarios) ? destinatarios.map(e=>text(e).toLowerCase()).filter(Boolean) : (destino ? [destino] : []);
    await getSupabase().from('email_envios').insert({
      tipo: tipo || 'administrativo',
      evento_id: evento_id || null,
      email_destino: destino,
      destinatarios: listaDestinos,
      assunto: assunto || '',
      mensagem: mensagem || '',
      status,
      erro: erro ? String(erro).slice(0,2000) : null,
      response_id: response?.response?.id || response?.id || response?.response?.data?.id || null,
      enviado_em:new Date().toISOString()
    });
  }catch(e){
    console.warn('Não foi possível registrar envio de e-mail:', e.message || e);
  }
}

async function envioJaRegistrado({tipo, evento_id, email_destino}){
  try{
    if(!tipo || !evento_id || !email_destino) return false;
    const {data,error}=await getSupabase().from('email_envios')
      .select('id')
      .eq('tipo', tipo)
      .eq('evento_id', evento_id)
      .eq('email_destino', String(email_destino).toLowerCase())
      .limit(1);
    if(error) throw error;
    return Array.isArray(data) && data.length > 0;
  }catch(e){
    console.warn('Não foi possível verificar histórico de e-mail:', e.message || e);
    return false;
  }
}

function urlPagamentoEvento(ev){
  return `${AUDESC_WEB_URL.replace(/\/$/,'')}/pagamento.html?evento=${encodeURIComponent(ev.id)}`;
}
function urlEventoPublico(ev){
  return `${AUDESC_WEB_URL.replace(/\/$/,'')}/evento.html?id=${encodeURIComponent(ev.id)}`;
}
function formatarMoeda(valor, moeda){
  const currency = moeda || moedaDoEvento({pais: 'Brasil'});
  try{return new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(Number(valor||0));}
  catch{return `R$ ${Number(valor||0).toFixed(2)}`;}
}
function formatarDataEvento(ev){
  if(!ev?.data_evento) return '';
  try{return new Date(ev.data_evento).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});}catch{return String(ev.data_evento);}
}

function montarEmailAgenda(ev, status){
  const titulo = ev.titulo_publicado || ev.titulo_original || 'Evento Audesc';
  const servico = nomeServico(ev.tipo_servico);
  const obs = text(ev.observacao_agenda);
  const valor = valorNumericoOuNull(ev.valor_final_agenda);
  const moeda = ev.moeda_pagamento || moedaDoEvento(ev);
  const disponivel = status === 'disponivel';
  const subject = disponivel ? `Audesc: agenda disponível para ${titulo}` : `Audesc: atualização sobre sua solicitação`;
  const linhas = [];
  linhas.push('Olá!');
  linhas.push('');
  if(disponivel){
    linhas.push('A disponibilidade de agenda para o serviço solicitado foi confirmada.');
  }else{
    linhas.push('No momento, não foi possível confirmar disponibilidade de agenda para o serviço solicitado.');
  }
  linhas.push('');
  linhas.push(`Evento: ${titulo}`);
  linhas.push(`Serviço: ${servico}`);
  const dataEv=formatarDataEvento(ev); if(dataEv) linhas.push(`Data e horário: ${dataEv}`);
  if(disponivel){
    linhas.push(`Valor final: ${formatarMoeda(valor || 0, moeda)}`);
    if((valor || 0) > 0) linhas.push(`Link para pagamento: ${urlPagamentoEvento(ev)}`);
  }
  if(obs) linhas.push(`Observação: ${obs}`);
  linhas.push('');
  linhas.push('Atenciosamente,');
  linhas.push('Equipe Audesc');
  const textEmail=linhas.join('\n');
  const html=`<div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
    <h1>${disponivel?'Agenda disponível':'Atualização sobre a agenda'}</h1>
    <p>Olá!</p>
    <p>${disponivel?'A disponibilidade de agenda para o serviço solicitado foi confirmada.':'No momento, não foi possível confirmar disponibilidade de agenda para o serviço solicitado.'}</p>
    <h2>Dados do evento</h2>
    <p><strong>Evento:</strong> ${escapeEmailHtml(titulo)}</p>
    <p><strong>Serviço:</strong> ${escapeEmailHtml(servico)}</p>
    ${formatarDataEvento(ev)?`<p><strong>Data e horário:</strong> ${escapeEmailHtml(formatarDataEvento(ev))}</p>`:''}
    ${disponivel?`<p><strong>Valor final:</strong> ${escapeEmailHtml(formatarMoeda(valor || 0, moeda))}</p>`:''}
    ${disponivel && (valor || 0) > 0 ? `<p><a href="${escapeEmailHtml(urlPagamentoEvento(ev))}">Acessar pagamento</a></p>`:''}
    ${obs?`<p><strong>Observação:</strong> ${escapeEmailHtml(obs)}</p>`:''}
    <p>Atenciosamente,<br>Equipe Audesc</p>
  </div>`;
  return {subject,text:textEmail,html};
}

async function enviarNotificacaoAgendaSeNecessario(evAntes, evDepois){
  const status = text(evDepois?.status_agenda);
  if(!['disponivel','indisponivel'].includes(status)) return {ok:false, skipped:true, reason:'status sem envio'};
  if(text(evAntes?.status_agenda) === status) return {ok:false, skipped:true, reason:'status não mudou'};
  if(!evDepois.email_usuario) return {ok:false, skipped:true, reason:'email_usuario ausente'};
  const tipo = status === 'disponivel' ? 'agenda_disponivel' : 'agenda_indisponivel';
  if(await envioJaRegistrado({tipo, evento_id:evDepois.id, email_destino:evDepois.email_usuario})){
    return {ok:false, skipped:true, reason:'envio já registrado'};
  }
  const conteudo = montarEmailAgenda(evDepois, status);
  const result = await enviarEmailResend({to:evDepois.email_usuario, subject:conteudo.subject, text:conteudo.text, html:conteudo.html, tags:[{name:'tipo',value:tipo}]});
  await registrarEmailEnvio({tipo, evento_id:evDepois.id, email_destino:evDepois.email_usuario, assunto:conteudo.subject, mensagem:conteudo.text, status:result.ok?'enviado':(result.skipped?'nao_enviado':'erro'), erro:result.ok?null:JSON.stringify(result), response:result});
  return result;
}

function codigoPaisNormalizado(valor, codigoAlternativo=''){
  return text(codigoAlternativo || codigoPaisMaps(valor) || valor).toUpperCase();
}
function inscritoCompatívelComEvento(inscrito, ev){
  if(!inscrito || !inscrito.email || inscrito.ativo !== true || inscrito.email_validado !== true) return false;
  if(inscrito.receber_todos === true) return true;
  const paisEvento=codigoPaisNormalizado(ev.pais,ev.pais_codigo);
  const paisInscrito=codigoPaisNormalizado(inscrito.pais,inscrito.pais_codigo);
  const abrangencia=text(ev.abrangencia_divulgacao).toLowerCase();
  if(abrangencia==='internacional'){
    const destinos=new Set(normalizarPaisesDivulgacao(ev.paises_divulgacao).map(p=>codigoPaisNormalizado(p)).filter(Boolean));
    if(!paisInscrito || !destinos.has(paisInscrito)) return false;
  }else{
    if(!paisEvento || !paisInscrito || paisEvento!==paisInscrito) return false;
    if(abrangencia!=='nacional'){
      const unidadeEvento=text(ev.unidade_codigo||codigoUnidadeLocal(paisEvento,ev.uf,ev.uf)).toUpperCase();
      const unidadeInscrito=text(inscrito.unidade_codigo||codigoUnidadeLocal(paisInscrito,inscrito.uf,inscrito.uf)).toUpperCase();
      if(unidadeEvento&&unidadeInscrito&&unidadeInscrito!=='NACIONAL'&&unidadeEvento!==unidadeInscrito)return false;
    }
  }
  if(Array.isArray(inscrito.eventos_ids)&&inscrito.eventos_ids.length)return inscrito.eventos_ids.map(String).includes(String(ev.id));
  return true;
}

function montarEmailEventoPublicado(ev){
  const titulo = ev.titulo_publicado || ev.titulo_original || 'Evento acessível divulgado no Audesc';
  const dataEv = formatarDataEvento(ev);
  const local = ev.local_evento || [ev.cidade, ev.uf, ev.pais].filter(Boolean).join(', ');
  const link = urlEventoPublico(ev);
  const subject = `Novo evento no Audesc: ${titulo}`;
  const textEmail = `Olá!\n\nUm novo evento foi publicado no Audesc para a região escolhida no seu cadastro.\n\nEvento: ${titulo}\n${dataEv?`Data e horário: ${dataEv}\n`:''}${local?`Local: ${local}\n`:''}\nAcessar evento: ${link}\n\nVocê recebeu esta mensagem porque cadastrou seu e-mail para receber notificações de eventos no Audesc.\n\nAtenciosamente,\nEquipe Audesc`;
  const html = `<div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
    <h1>Novo evento no Audesc</h1>
    <p>Olá!</p>
    <p>Um novo evento foi publicado no Audesc para a região escolhida no seu cadastro.</p>
    <h2>${escapeEmailHtml(titulo)}</h2>
    ${dataEv?`<p><strong>Data e horário:</strong> ${escapeEmailHtml(dataEv)}</p>`:''}
    ${local?`<p><strong>Local:</strong> ${escapeEmailHtml(local)}</p>`:''}
    <p><a href="${escapeEmailHtml(link)}">Acessar evento</a></p>
    <p>Você recebeu esta mensagem porque cadastrou seu e-mail para receber notificações de eventos no Audesc.</p>
    <p>Atenciosamente,<br>Equipe Audesc</p>
  </div>`;
  return {subject,text:textEmail,html};
}

async function notificarInscritosEventoPublicado(evAntes, evDepois){
  if(text(evDepois?.tipo_evento) !== 'publico') return {ok:false, skipped:true, reason:'evento privado'};
  if(text(evDepois?.status_publicacao) !== 'aprovado') return {ok:false, skipped:true, reason:'evento não aprovado'};
  if(text(evAntes?.status_publicacao) === 'aprovado') return {ok:false, skipped:true, reason:'evento já aprovado antes'};
  const sb=getSupabase();
  let inscritos=[];
  try{
    const {data,error}=await sb.from('notificacoes').select('*').eq('ativo',true).eq('email_validado',true).limit(2000);
    if(error) throw error;
    inscritos=(data||[]).filter(n=>inscritoCompatívelComEvento(n, evDepois));
  }catch(e){
    console.warn('Não foi possível consultar inscritos para notificação:', e.message || e);
    return {ok:false,error:String(e.message||e)};
  }
  const conteudo=montarEmailEventoPublicado(evDepois);
  const resultados=[];
  for(const n of inscritos){
    const email=text(n.email).toLowerCase();
    if(!email) continue;
    const tipo='evento_publicado';
    if(await envioJaRegistrado({tipo, evento_id:evDepois.id, email_destino:email})) continue;
    const result=await enviarEmailResend({to:email, subject:conteudo.subject, text:conteudo.text, html:conteudo.html, tags:[{name:'tipo',value:tipo}]});
    await registrarEmailEnvio({tipo, evento_id:evDepois.id, email_destino:email, assunto:conteudo.subject, mensagem:conteudo.text, status:result.ok?'enviado':(result.skipped?'nao_enviado':'erro'), erro:result.ok?null:JSON.stringify(result), response:result});
    if(result.ok){
      try{
        await sb.from('notificacoes').update({ultimo_envio_em:new Date().toISOString(), total_envios:Number(n.total_envios||0)+1}).eq('email', email);
      }catch(e){ console.warn('Não foi possível atualizar contador da notificação:', e.message||e); }
    }
    resultados.push({email, ok:!!result.ok, status:result.status || null});
  }
  return {ok:true,total:resultados.length,resultados};
}

async function liberar(req,res){
 try{
  if(!admin(req,res)) return;
  const sb=getSupabase();
  const {data:ev,error}=await sb.from('eventos').select('*').eq('id',req.params.id).single();
  if(error||!ev) return res.status(404).json({error:'Evento não encontrado.'});
  if(ev.status_publicacao!=='aprovado') return res.status(400).json({error:'Evento ainda não está aprovado.'});
  const evSincronizado = await sincronizarStatusPagamentoDivulgacao(ev);
  if((eventoUsaTransmissao(evSincronizado) || eventoTemDivulgacao(evSincronizado)) && evSincronizado.status_pagamento!=='pago' && evSincronizado.status_pagamento!=='dispensado') return res.status(400).json({error:'Evento ainda não consta como pago.'});
  if(eventoTemDivulgacao(evSincronizado)){
   const {data:up,error:er}=await sb.from('eventos').update({status_operacao:'liberado',data_ultima_edicao:new Date().toISOString()}).eq('id',req.params.id).select().single();
   if(er) throw er; return res.json({ok:true,tipo:'divulgacao_gratuita',evento:up});
  }
  const { senha, sala } = await gerarCredenciaisTransmissao(ev, sb);
  const enviarEmailLiberacaoAdmin = !(
    req.query?.enviar_email === 'false' ||
    req.query?.sem_email === 'true' ||
    req.body?.enviar_email === false ||
    req.body?.sem_email === true
  );
  // A ordem passa a existir no próprio Audesc/Supabase.
  // A planilha Google é apenas sincronização auxiliar, para evitar bloqueio por falhas temporárias do Google OAuth/Sheets.
  const {data:up,error:er}=await sb.from('eventos').update({
    senha_transmissor:senha,
    sala_codigo:sala,
    status_operacao:'liberado',
    planilha_liberacao_status:'pendente',
    planilha_liberacao_erro:null,
    data_ultima_edicao:new Date().toISOString()
  }).eq('id',req.params.id).select().single();
  if(er) throw er;
  let planilha_resultado = {ok:false, skipped:true, status:'pendente'};
  try{
    await appendSheet(up, senha, sala);
    await registrarStatusPlanilha(up.id, 'sincronizado', null);
    planilha_resultado = {ok:true, status:'sincronizado'};
  }catch(planilhaErro){
    const msg = String(planilhaErro && planilhaErro.message ? planilhaErro.message : planilhaErro);
    await registrarStatusPlanilha(up.id, 'erro', msg);
    planilha_resultado = {ok:false, status:'erro', error:msg};
  }
  let email_resultado = { ok:false, skipped:true, reason:'Envio automático desmarcado pelo administrador.' };
  if(enviarEmailLiberacaoAdmin){
    email_resultado = await enviarEmailLiberacao(up, senha, sala).catch(err => {
      console.error('Falha inesperada ao enviar e-mail de liberação:', err);
      return { ok:false, error:String(err && err.message ? err.message : err) };
    });
  }
  await registrarResultadoEmail(up.id, email_resultado);
  res.json({ok:true,tipo:'audesc_transmissao',senha_transmissor:senha,sala_codigo:sala,email_resultado,planilha_resultado,evento:up});
 }catch(e){ console.error(e); res.status(500).json({error:e.message||'Erro ao liberar evento.'}); }
}
app.post('/liberar-evento/:id',liberar);
app.get('/liberar-evento/:id',liberar);
app.post('/admin/eventos/:id/regerar-ordem', async (req,res)=>{
  try{
    if(!admin(req,res)) return;
    const sb=getSupabase();
    const {data:ev,error}=await sb.from('eventos').select('*').eq('id',req.params.id).single();
    if(error||!ev) return res.status(404).json({error:'Evento não encontrado.'});
    if(!eventoUsaTransmissao(ev)) return res.status(400).json({error:'Este serviço não utiliza transmissão Audesc.'});
    const senha = ev.senha_transmissor || await gerarSenhaUnica(sb);
    const sala = ev.sala_codigo || await gerarSalaUnica(sb);
    const {data:up,error:er}=await sb.from('eventos').update({
      senha_transmissor:senha,
      sala_codigo:sala,
      status_operacao:'liberado',
      planilha_liberacao_status:'pendente',
      planilha_liberacao_erro:null,
      data_ultima_edicao:new Date().toISOString()
    }).eq('id',req.params.id).select().single();
    if(er) throw er;
    let planilha_resultado = {ok:false, status:'pendente'};
    try{
      await appendSheet(up, senha, sala);
      await registrarStatusPlanilha(up.id, 'sincronizado', null);
      planilha_resultado = {ok:true, status:'sincronizado'};
    }catch(planilhaErro){
      const msg = String(planilhaErro && planilhaErro.message ? planilhaErro.message : planilhaErro);
      await registrarStatusPlanilha(up.id, 'erro', msg);
      planilha_resultado = {ok:false, status:'erro', error:msg};
    }
    res.json({ok:true,mensagem: planilha_resultado.ok ? 'Ordem gerada no Audesc e sincronizada com a planilha.' : 'Ordem gerada no Audesc, mas ainda não sincronizada com a planilha Google.', senha_transmissor:senha,sala_codigo:sala,planilha_resultado,evento:up});
  }catch(e){
    console.error('Erro ao gerar/sincronizar ordem:', e);
    res.status(500).json({error:e.message||'Erro ao gerar ordem de transmissão.'});
  }
});


app.get('/admin/google-sheets/diagnostico', async (req,res)=>{
  try{
    if(!admin(req,res)) return;
    const diag = await diagnosticarGoogleSheets();
    res.status(diag.ok ? 200 : 500).json(diag);
  }catch(e){
    res.status(500).json({ ok:false, error:e.message || 'Erro ao diagnosticar Google Sheets.' });
  }
});

app.post('/admin/eventos/:id/sincronizar-planilha', async (req,res)=>{
  try{
    if(!admin(req,res)) return;
    const sb=getSupabase();
    const {data:ev,error}=await sb.from('eventos').select('*').eq('id',req.params.id).single();
    if(error||!ev) return res.status(404).json({error:'Evento não encontrado.'});
    if(!eventoUsaTransmissao(ev)) return res.status(400).json({error:'Este serviço não utiliza transmissão Audesc.'});
    const senha = ev.senha_transmissor || await gerarSenhaUnica(sb);
    const sala = ev.sala_codigo || await gerarSalaUnica(sb);
    let eventoParaPlanilha = ev;
    if(!ev.senha_transmissor || !ev.sala_codigo){
      const {data:up,error:er}=await sb.from('eventos').update({
        senha_transmissor: senha,
        sala_codigo: sala,
        data_ultima_edicao: new Date().toISOString()
      }).eq('id',req.params.id).select().single();
      if(er) throw er;
      eventoParaPlanilha = up;
    }
    try{
      await appendSheet(eventoParaPlanilha, senha, sala);
      await atualizarStatusPlanilhaLiberacao(sb, eventoParaPlanilha.id, 'sincronizado', null);
      res.json({ok:true,mensagem:'Ordem sincronizada com a planilha Google.', sala_codigo:sala, senha_transmissor:senha});
    }catch(e){
      const msg = String(e && e.message ? e.message : e);
      await atualizarStatusPlanilhaLiberacao(sb, eventoParaPlanilha.id, 'erro', msg);
      res.status(500).json({ok:false,error:'Não foi possível sincronizar com a planilha Google.', detalhe:msg});
    }
  }catch(e){
    res.status(500).json({error:e.message||'Erro ao sincronizar ordem com a planilha.'});
  }
});




// Fase 6.11 — catálogo administrável de países.
async function obterCatalogoPaises(){
  try{
    const {data,error}=await getSupabase().from('paises_disponiveis').select('*').order('ordem',{ascending:true}).order('nome',{ascending:true});
    if(error) throw error;
    if(Array.isArray(data)&&data.length) return data;
  }catch(e){ console.warn('Catálogo de países indisponível; usando catálogo incorporado:',e.message||e); }
  return PAISES_COMERCIAIS.map((p,i)=>({codigo_iso:p.codigo,nome:p.nome,moeda:p.moeda,grupo:p.grupo,habilitado:true,configurado:p.configurado,ordem:i+1}));
}

app.get('/paises-disponiveis', async (req,res)=>{
  try{
    const catalogo=await obterCatalogoPaises();
    res.json({ok:true,paises:catalogo.filter(p=>p.habilitado!==false).sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR',{sensitivity:'base'}))});
  }catch(e){res.status(500).json({error:e.message||'Erro ao carregar países disponíveis.'});}
});

app.get('/admin/paises-disponiveis', async (req,res)=>{
  try{
    if(!admin(req,res)) return;
    res.json({ok:true,paises:await obterCatalogoPaises()});
  }catch(e){res.status(500).json({error:e.message||'Erro ao carregar catálogo de países.'});}
});

app.patch('/admin/paises-disponiveis', async (req,res)=>{
  try{
    if(!admin(req,res)) return;
    const recebidos=Array.isArray(req.body?.paises)?req.body.paises:[];
    const permitidos=new Map(PAISES_COMERCIAIS.map(p=>[p.codigo,p]));
    const agora=new Date().toISOString();
    const linhas=recebidos.map((item,indice)=>{
      const codigo=String(item?.codigo_iso||'').trim().toUpperCase();
      const meta=permitidos.get(codigo);
      if(!meta) return null;
      return {codigo_iso:codigo,nome:meta.nome,moeda:meta.moeda,grupo:meta.grupo,habilitado:item?.habilitado===true,configurado:item?.configurado===true||meta.configurado===true,ordem:Number.isFinite(Number(item?.ordem))?Number(item.ordem):indice+1,atualizado_em:agora};
    }).filter(Boolean);
    if(!linhas.length) return res.status(400).json({error:'Nenhum país válido foi informado.'});
    const {data,error}=await getSupabase().from('paises_disponiveis').upsert(linhas,{onConflict:'codigo_iso'}).select();
    if(error) throw error;
    res.json({ok:true,paises:data});
  }catch(e){res.status(500).json({error:e.message||'Erro ao salvar catálogo de países.'});}
});

app.get('/formulario-config', async (req,res)=>{
  try{
    const cfg = await obterFormularioConfig();
    res.json({ok:true,config:cfg,servicos:SERVICOS_CONFIG,categorias_evento:CATEGORIAS_EVENTO});
  }catch(e){
    res.status(500).json({error:e.message || 'Erro ao carregar configuração do formulário.'});
  }
});

app.get('/admin/formulario-config', async (req,res)=>{
  try{
    if(!admin(req,res)) return;
    const cfg = await obterFormularioConfig();
    res.json({ok:true,config:cfg,servicos:SERVICOS_CONFIG,categorias_evento:CATEGORIAS_EVENTO});
  }catch(e){
    res.status(500).json({error:e.message || 'Erro ao carregar configuração do formulário.'});
  }
});

app.patch('/admin/formulario-config', async (req,res)=>{
  try{
    if(!admin(req,res)) return;
    const cfg = sanitizarFormularioConfig(req.body?.config || req.body || {});
    const {data,error} = await getSupabase().from('formulario_config').upsert({id:'default',config:cfg,updated_at:new Date().toISOString()},{onConflict:'id'}).select().single();
    if(error) throw error;
    res.json({ok:true,config:data.config});
  }catch(e){
    res.status(500).json({error:e.message || 'Erro ao salvar configuração do formulário.'});
  }
});

app.get('/admin/configuracao-comercial-paises', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const {data,error}=await getSupabase().from('configuracao_comercial_pais').select('*').order('pais_nome',{ascending:true});
  if(error) throw error;
  const porCodigo=new Map((data||[]).map(x=>[x.pais_codigo,x]));
  const configuracoes=PAISES_COMERCIAIS.map(meta=>{
    const recomendada=recomendacaoComercialPais(meta);
    const salva=porCodigo.get(meta.codigo)||{};
    const moeda=String(salva.moeda||recomendada.moeda_recomendada).toUpperCase();
    const plataforma=salva.plataforma_pagamento||recomendada.plataforma_recomendada;
    return Object.assign({pais_codigo:meta.codigo,pais_nome:meta.nome,moeda,plataforma_pagamento:plataforma,pagamentos_ativos:true},salva,recomendada,{integracao_disponivel:plataformaDisponivelNoServidor(plataforma,meta.codigo,moeda)});
  }).sort((a,b)=>String(a.pais_nome).localeCompare(String(b.pais_nome),'pt-BR',{sensitivity:'base'}));
  res.json({ok:true,configuracoes,moedas_paddle:[...MOEDAS_PADDLE_SUPORTADAS],regra_gateway:'BR usa Mercado Pago; demais países usam Paddle; moedas locais não aceitas usam USD.'});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao carregar configurações comerciais.'});}
});
app.patch('/admin/configuracao-comercial-paises/:paisCodigo', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const codigo=String(req.params.paisCodigo||'').toUpperCase();
  const meta=PAIS_COMERCIAL_POR_CODIGO.get(codigo);
  if(!meta) return res.status(400).json({error:'País inválido.'});
  const moeda=String(req.body?.moeda||meta.moeda).toUpperCase();
  const plataforma=text(req.body?.plataforma_pagamento);
  if(!['mercadopago','paddle'].includes(plataforma)) return res.status(400).json({error:'Plataforma de pagamento inválida.'});
  if(plataforma==='mercadopago' && codigo!=='BR') return res.status(400).json({error:'As credenciais atuais do Mercado Pago pertencem ao Brasil. Para outro país, será necessário cadastrar credenciais específicas daquele mercado.'});
  if(plataforma==='mercadopago' && moeda!=='BRL') return res.status(400).json({error:'A integração atual do Mercado Pago está configurada para BRL.'});
  if(plataforma==='paddle' && !MOEDAS_PADDLE_SUPORTADAS.has(moeda)) return res.status(400).json({error:'A moeda '+moeda+' não é aceita atualmente pelo Paddle. Para este país, use USD.'});
  const payload={pais_codigo:codigo,pais_nome:meta.nome,moeda,plataforma_pagamento:plataforma,pagamentos_ativos:req.body?.pagamentos_ativos!==false,atualizado_em:new Date().toISOString()};
  const {data,error}=await getSupabase().from('configuracao_comercial_pais').upsert(payload,{onConflict:'pais_codigo'}).select().single();
  if(error) throw error;
  // Mantém preços e cupons do país coerentes com a moeda comercial escolhida.
  try{await getSupabase().from('precificacao_pais_servicos').update({moeda,atualizado_em:new Date().toISOString()}).eq('pais_codigo',codigo);}catch(_e){}
  try{await getSupabase().from('cupons').update({moeda,atualizado_em:new Date().toISOString()}).eq('pais_codigo',codigo);}catch(_e){}
  const recomendada=recomendacaoComercialPais(meta);
  res.json({ok:true,configuracao:Object.assign({},data,recomendada,{integracao_disponivel:plataformaDisponivelNoServidor(plataforma,codigo,moeda)})});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao salvar configuração comercial.'});}
});
app.get('/admin/precificacao-pais/:paisCodigo', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const codigo=String(req.params.paisCodigo||'').toUpperCase();
  const cfg=await obterConfiguracaoComercialPais(codigo);
  const {data,error}=await getSupabase().from('precificacao_pais_servicos').select('*').eq('pais_codigo',codigo);
  if(error) throw error;
  const existentes=new Map((data||[]).map(x=>[x.tipo_servico,x]));
  const ativos=SERVICOS_CONFIG.filter(s=>s.ativo!==false && s.codigo!=='audesc_com_audiodescritor');
  const faltantes=[];
  for(const servico of ativos){
   if(existentes.has(servico.codigo)) continue;
   let legado=null;
   try{const r=await getSupabase().from('precificacao_servicos').select('*').eq('tipo_servico',servico.codigo).eq('moeda',cfg.moeda).maybeSingle();legado=r.data||null;}catch(_e){}
   faltantes.push({pais_codigo:codigo,tipo_servico:servico.codigo,moeda:cfg.moeda,valor_hora:Number(legado?.valor_hora||0),valor_base_10_ouvintes_1_hora:Number(legado?.valor_base_10_ouvintes_1_hora||0),acrescimo_por_10_ouvintes:Number(legado?.acrescimo_por_10_ouvintes||0),ouvintes_minimos:Number(legado?.ouvintes_minimos||10),duracao_minima_horas:Number(legado?.duracao_minima_horas||1),desconto_percentual:0,ativo:true,atualizado_em:new Date().toISOString()});
  }
  let todos=[...(data||[])];
  if(faltantes.length){const ins=await getSupabase().from('precificacao_pais_servicos').insert(faltantes).select('*');if(ins.error)throw ins.error;todos.push(...(ins.data||[]));}
  const ordem=new Map(SERVICOS_CONFIG.map(s=>[s.codigo,Number(s.ordem||999)]));
  todos.sort((a,b)=>(ordem.get(a.tipo_servico)||999)-(ordem.get(b.tipo_servico)||999));
  res.json({ok:true,configuracao:cfg,precificacao:todos});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao carregar precificação do país.'});}
});
app.patch('/admin/precificacao-pais/:id', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const b=req.body||{};
  const desconto=Math.max(0,Math.min(100,Number(b.desconto_percentual||0)));
  const update={valor_base_10_ouvintes_1_hora:Number(b.valor_base_10_ouvintes_1_hora||0),acrescimo_por_10_ouvintes:Number(b.acrescimo_por_10_ouvintes||0),valor_hora:Number(b.valor_hora||0),ouvintes_minimos:Number(b.ouvintes_minimos||10),duracao_minima_horas:Number(b.duracao_minima_horas||1),desconto_percentual:desconto,ativo:b.ativo!==false,atualizado_em:new Date().toISOString()};
  const {data,error}=await getSupabase().from('precificacao_pais_servicos').update(update).eq('id',req.params.id).select().single();
  if(error) throw error;
  res.json({ok:true,precificacao:data});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao salvar precificação.'});}
});
app.get('/admin/cupons', async (req,res)=>{
 try{if(!admin(req,res))return;let q=getSupabase().from('cupons').select('*').order('criado_em',{ascending:false});if(req.query.pais_codigo)q=q.eq('pais_codigo',String(req.query.pais_codigo).toUpperCase());const {data,error}=await q;if(error)throw error;res.json({ok:true,cupons:data||[]});}
 catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao carregar cupons.'});}
});
app.post('/admin/cupons', async (req,res)=>{
 try{
  if(!admin(req,res))return;const b=req.body||{};const codigo=text(b.codigo).toUpperCase();if(!codigo)return res.status(400).json({error:'Informe o código do cupom.'});const tipo=text(b.tipo_desconto);if(!['percentual','valor_fixo'].includes(tipo))return res.status(400).json({error:'Tipo de desconto inválido.'});
  const payload={codigo,tipo_desconto:tipo,valor_desconto:Number(b.valor_desconto||0),pais_codigo:text(b.pais_codigo).toUpperCase()||null,moeda:text(b.moeda).toUpperCase()||null,servicos_aplicaveis:Array.isArray(b.servicos_aplicaveis)?b.servicos_aplicaveis.filter(servicoAtivo):[],ativo:b.ativo!==false,validade:b.validade||null,limite_uso:b.limite_uso===''||b.limite_uso==null?null:Number(b.limite_uso),atualizado_em:new Date().toISOString()};
  const {data,error}=await getSupabase().from('cupons').insert(payload).select().single();if(error)throw error;res.json({ok:true,cupom:data});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao criar cupom.'});}
});
app.patch('/admin/cupons/:id', async (req,res)=>{
 try{if(!admin(req,res))return;const b=req.body||{};const update={atualizado_em:new Date().toISOString()};['codigo','tipo_desconto','moeda','pais_codigo'].forEach(k=>{if(Object.prototype.hasOwnProperty.call(b,k))update[k]=k==='codigo'?text(b[k]).toUpperCase():(text(b[k]).toUpperCase()||null);});['valor_desconto','limite_uso'].forEach(k=>{if(Object.prototype.hasOwnProperty.call(b,k))update[k]=(b[k]===''||b[k]==null)?null:Number(b[k]);});if(Object.prototype.hasOwnProperty.call(b,'ativo'))update.ativo=!!b.ativo;if(Object.prototype.hasOwnProperty.call(b,'validade'))update.validade=b.validade||null;if(Object.prototype.hasOwnProperty.call(b,'servicos_aplicaveis'))update.servicos_aplicaveis=Array.isArray(b.servicos_aplicaveis)?b.servicos_aplicaveis.filter(servicoAtivo):[];const {data,error}=await getSupabase().from('cupons').update(update).eq('id',req.params.id).select().single();if(error)throw error;res.json({ok:true,cupom:data});}
 catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao atualizar cupom.'});}
});
app.delete('/admin/cupons/:id', async (req,res)=>{
 try{if(!admin(req,res))return;const {error}=await getSupabase().from('cupons').delete().eq('id',req.params.id);if(error)throw error;res.json({ok:true});}
 catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao excluir cupom.'});}
});

app.get('/pagamentos/calcular/:id', async (req,res)=>{
 try{
  const user=await getUser(req);
  if(!user || !user.email) return res.status(401).json({error:'E-mail não autenticado. Acesse pelo link de validação.'});

  const email=String(user.email).toLowerCase();
  const {data:ev,error}=await getSupabase().from('eventos').select('*').eq('id',req.params.id).eq('email_usuario',email).single();
  if(error) throw error;
  if(!ev) return res.status(404).json({error:'Evento não encontrado.'});

  const dados=await calcularPagamentoEvento(ev, req.query.cupom || '');
  res.json({ok:true,calculo:dados});
 }catch(e){
  console.error(e);
  res.status(400).json({error:e.message||'Erro ao calcular pagamento.'});
 }
});






app.get('/admin/precificacao-servicos', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const sb=getSupabase();
  let {data,error}=await sb.from('precificacao_servicos').select('*').order('tipo_servico',{ascending:true}).order('moeda',{ascending:true});
  if(error) throw error;

  // Garante que a página de precificação sempre tenha campos para todos os serviços ativos.
  // Isso evita que novos serviços centralizados em data/servicos.json fiquem invisíveis até uma inserção manual no banco.
  const existentes = new Set((data||[]).map(p => String(p.tipo_servico||'') + '|' + String(p.moeda||'')));
  let moedas = [...new Set((data||[]).map(p => p.moeda).filter(Boolean))];
  let precificacaoBase = [];
  try{
    const baseResp = await sb.from('precificacao').select('*').order('moeda',{ascending:true});
    if(!baseResp.error && Array.isArray(baseResp.data)) precificacaoBase = baseResp.data;
  }catch(_e){}
  if(!moedas.length) moedas = [...new Set(precificacaoBase.map(p => p.moeda).filter(Boolean))];
  if(!moedas.length) moedas = ['BRL','EUR','USD'];
  const basePorMoeda = new Map(precificacaoBase.map(p => [p.moeda, p]));

  const defaults = [];
  for(const servico of SERVICOS_CONFIG.filter(s => s.ativo !== false)){
    for(const moeda of moedas){
      const key = servico.codigo + '|' + moeda;
      if(existentes.has(key)) continue;
      const base = basePorMoeda.get(moeda) || {};
      const usaPacote = !!servico.usaTransmissao && !servico.somenteProfissional && !servico.somenteDivulgacao;
      defaults.push({
        tipo_servico: servico.codigo,
        moeda,
        valor_hora: 0,
        valor_base_10_ouvintes_1_hora: usaPacote ? Number(base.valor_base_10_ouvintes_1_hora || 0) : 0,
        acrescimo_por_10_ouvintes: usaPacote ? Number(base.acrescimo_por_10_ouvintes || 0) : 0,
        ouvintes_minimos: usaPacote ? Number(base.ouvintes_minimos || 10) : 10,
        duracao_minima_horas: usaPacote ? Number(base.duracao_minima_horas || 1) : 1,
        atualizado_em: new Date().toISOString()
      });
    }
  }
  if(defaults.length){
    const ins = await sb.from('precificacao_servicos').insert(defaults).select('*');
    if(ins.error) console.warn('Não foi possível criar precificações faltantes:', ins.error.message || ins.error);
    else data = [...(data||[]), ...(ins.data||[])];
  }

  const ordemServico = new Map(SERVICOS_CONFIG.map(s => [s.codigo, Number(s.ordem || 999)]));
  data = (data||[]).sort((a,b)=>(ordemServico.get(a.tipo_servico)||999)-(ordemServico.get(b.tipo_servico)||999) || String(a.moeda).localeCompare(String(b.moeda)));
  res.json({ok:true,precificacao:data||[]});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao carregar precificação dos serviços.'});}
});
app.patch('/admin/precificacao-servicos/:id', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const b=req.body||{};
  const update={valor_base_10_ouvintes_1_hora:Number(b.valor_base_10_ouvintes_1_hora||0),acrescimo_por_10_ouvintes:Number(b.acrescimo_por_10_ouvintes||0),valor_hora:Number(b.valor_hora||0),ouvintes_minimos:Number(b.ouvintes_minimos||10),duracao_minima_horas:Number(b.duracao_minima_horas||1),atualizado_em:new Date().toISOString()};
  const {data,error}=await getSupabase().from('precificacao_servicos').update(update).eq('id',req.params.id).select().single();
  if(error) throw error;
  res.json({ok:true,precificacao:data});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao salvar precificação do serviço.'});}
});

app.get('/admin/agenda-pendencias', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const sb=getSupabase();
  const {data,error}=await sb
   .from('eventos')
   .select('id,titulo_original,titulo_publicado,email_usuario,tipo_servico,servicos_solicitados,pais,uf,pais_codigo,unidade_codigo,timezone,cidade,origem_transmissao,local_evento,latitude,longitude,data_evento,status_agenda,observacao_agenda,valor_sugerido_agenda,valor_final_agenda,valor_agenda_definido_por_admin,status_pagamento,status_publicacao,status_operacao,created_at')
   .neq('status_agenda','nao_aplicavel')
   .order('created_at',{ascending:false})
   .limit(300);
  if(error) throw error;
  const eventos=(data||[]).map(ev=>Object.assign({},ev,{status_agenda:statusAgendaEvento(ev)}));
  res.json({ok:true,eventos});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message||'Erro ao listar pendências de agenda.'});
 }
});

app.get('/admin/eventos/:id/valor-agenda', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const {data:ev,error}=await getSupabase().from('eventos').select('*').eq('id',req.params.id).single();
  if(error) throw error;
  if(!requerAgendaProfissional(ev)) return res.status(400).json({error:'Este serviço não depende de agenda de profissional.'});
  const calculo=await calcularValorSugeridoAgenda(ev);
  const valorFinal=valorNumericoOuNull(ev.valor_final_agenda);
  res.json({
   ok:true,
   moeda:calculo.moeda,
   valor_sugerido_agenda:calculo.valor_sugerido_agenda,
   valor_final_agenda:valorFinal === null ? calculo.valor_sugerido_agenda : valorFinal,
   pacote:calculo.pacote
  });
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message||'Erro ao calcular valor de agenda.'});
 }
});

app.patch('/admin/eventos/:id/agenda', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const status=text(req.body?.status_agenda || req.body?.status);
  if(!['pendente','disponivel','indisponivel'].includes(status)){
   return res.status(400).json({error:'Status de agenda inválido.'});
  }
  const {data:ev,error:evError}=await getSupabase().from('eventos').select('*').eq('id',req.params.id).single();
  if(evError) throw evError;
  if(!requerAgendaProfissional(ev)) return res.status(400).json({error:'Este serviço não depende de agenda de profissional.'});

  const calculo=await calcularValorSugeridoAgenda(ev);
  let valorFinal=valorNumericoOuNull(req.body?.valor_final_agenda);
  if(valorFinal === null) valorFinal = valorNumericoOuNull(ev.valor_final_agenda);
  if(valorFinal === null) valorFinal = calculo.valor_sugerido_agenda;

  const update={
   status_agenda:status,
   observacao_agenda:text(req.body?.observacao_agenda || req.body?.observacao),
   valor_sugerido_agenda:calculo.valor_sugerido_agenda,
   valor_final_agenda:valorFinal,
   valor_agenda_definido_por_admin: status === 'disponivel',
   agenda_atualizado_em:new Date().toISOString(),
   data_ultima_edicao:new Date().toISOString()
  };
  if(status === 'disponivel') update.status_pagamento = valorFinal > 0 ? 'pendente' : 'dispensado';
  if(status === 'indisponivel') update.status_pagamento = 'cancelado';
  if(status === 'pendente') update.status_pagamento = 'pendente';
  const {data,error}=await getSupabase()
   .from('eventos')
   .update(update)
   .eq('id',req.params.id)
   .select()
   .single();
  if(error) throw error;
  const email_agenda_resultado = await enviarNotificacaoAgendaSeNecessario(ev, data).catch(err => {
   console.error('Falha ao enviar e-mail de agenda:', err);
   return {ok:false,error:String(err && err.message ? err.message : err)};
  });
  res.json({ok:true,evento:data,valor_sugerido_agenda:calculo.valor_sugerido_agenda,valor_final_agenda:valorFinal,email_agenda_resultado});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message||'Erro ao atualizar agenda do evento.'});
 }
});


app.get('/admin/emails', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const sb=getSupabase();

  const {data:eventos,error:eventosError}=await sb
   .from('eventos')
   .select('email_usuario,created_at')
   .not('email_usuario','is',null)
   .limit(1000);
  if(eventosError) throw eventosError;

  const {data:notifs,error:notifsError}=await sb
   .from('notificacoes')
   .select('email,ativo,email_validado,updated_at,ultimo_envio_em,total_envios,status')
   .not('email','is',null)
   .limit(1000);
  if(notifsError) throw notifsError;

  const {data:statusRows,error:statusError}=await sb
   .from('email_status')
   .select('*');
  if(statusError) throw statusError;

  let enviosRows=[];
  try{
   const enviosResp=await sb
    .from('email_envios')
    .select('email_destino,destinatarios,tipo,enviado_em,status')
    .order('enviado_em',{ascending:false})
    .limit(3000);
   if(!enviosResp.error && Array.isArray(enviosResp.data)) enviosRows=enviosResp.data;
  }catch(e){
   console.warn('Histórico de envios indisponível:', e.message||e);
  }

  const mapa=new Map();

  function garantir(email){
   const e=text(email).toLowerCase();
   if(!e) return null;
   if(!mapa.has(e)){
    mapa.set(e,{
     email:e,
     origem_eventos:false,
     origem_notificacoes:false,
     total_eventos:0,
     notificacoes_ativas:false,
     notificacoes_validadas:false,
     status:'comum',
     observacao:'',
     atualizado_em:null,
     total_envios:0,
     ultimo_envio:null,
     ultimo_envio_tipo:'',
     ultimo_envio_status:''
    });
   }
   return mapa.get(e);
  }

  for(const ev of eventos||[]){
   const item=garantir(ev.email_usuario);
   if(item){
    item.origem_eventos=true;
    item.total_eventos++;
   }
  }

  for(const n of notifs||[]){
   const item=garantir(n.email);
   if(item){
    item.origem_notificacoes=true;
    item.notificacoes_ativas = item.notificacoes_ativas || !!n.ativo;
    item.notificacoes_validadas = item.notificacoes_validadas || !!n.email_validado;
    item.total_envios = Math.max(Number(item.total_envios||0), Number(n.total_envios||0));
    if(n.ultimo_envio_em && (!item.ultimo_envio || new Date(n.ultimo_envio_em) > new Date(item.ultimo_envio))){
     item.ultimo_envio=n.ultimo_envio_em;
     item.ultimo_envio_tipo='notificação automática';
     item.ultimo_envio_status=n.status || '';
    }
   }
  }

  for(const s of statusRows||[]){
   const item=garantir(s.email);
   if(item){
    item.status=s.status || 'comum';
    item.observacao=s.observacao || '';
    item.atualizado_em=s.atualizado_em || null;
   }
  }

  for(const envio of enviosRows||[]){
   const destinos=[];
   if(envio.email_destino) destinos.push(envio.email_destino);
   if(Array.isArray(envio.destinatarios)) destinos.push(...envio.destinatarios);
   for(const raw of destinos){
    const item=garantir(raw);
    if(item){
     item.total_envios++;
     if(!item.ultimo_envio || (envio.enviado_em && new Date(envio.enviado_em) > new Date(item.ultimo_envio))){
      item.ultimo_envio=envio.enviado_em || null;
      item.ultimo_envio_tipo=envio.tipo || '';
      item.ultimo_envio_status=envio.status || '';
     }
    }
   }
  }

  const emails=[...mapa.values()].sort((a,b)=>a.email.localeCompare(b.email));
  res.json({ok:true,total:emails.length,emails});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message||'Erro ao listar e-mails.'});
 }
});

app.patch('/admin/emails/status', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const emails=Array.isArray(req.body?.emails)?req.body.emails:[];
  const statusEmail=text(req.body?.status);
  const observacao=text(req.body?.observacao);
  if(!['comum','confiavel','bloqueado'].includes(statusEmail)) return res.status(400).json({error:'Status inválido.'});
  if(!emails.length) return res.status(400).json({error:'Selecione ao menos um e-mail.'});

  const sb=getSupabase();
  const resultados=[];
  for(const raw of emails){
   const email=text(raw).toLowerCase();
   if(!email || !email.includes('@')) continue;
   const payload={email,status:statusEmail,observacao,atualizado_em:new Date().toISOString()};
   const {data,error}=await sb.from('email_status').upsert(payload,{onConflict:'email'}).select().single();
   if(error) throw error;
   resultados.push(data);
  }
  res.json({ok:true,total:resultados.length,emails:resultados});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message||'Erro ao atualizar status de e-mails.'});
 }
});

app.delete('/admin/emails', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const emails=Array.isArray(req.body?.emails)?req.body.emails.map(e=>text(e).toLowerCase()).filter(Boolean):[];
  if(!emails.length) return res.status(400).json({error:'Selecione ao menos um e-mail.'});

  const sb=getSupabase();
  await sb.from('notificacoes').delete().in('email', emails);
  await sb.from('email_status').delete().in('email', emails);

  res.json({
   ok:true,
   mensagem:'E-mails removidos das notificações e da lista de controle. Eventos já cadastrados foram preservados.',
   total:emails.length
  });
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message||'Erro ao excluir e-mails.'});
 }
});

app.post('/admin/emails/enviar-mensagem', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  if(!RESEND_API_KEY) return res.status(500).json({error:'RESEND_API_KEY não configurada.'});

  const emails=Array.isArray(req.body?.emails)?req.body.emails.map(e=>text(e).toLowerCase()).filter(Boolean):[];
  const assunto=limit(req.body?.assunto,200);
  const mensagem=text(req.body?.mensagem);
  const anexos=Array.isArray(req.body?.anexos)?req.body.anexos:[];

  if(!emails.length) return res.status(400).json({error:'Selecione ao menos um e-mail.'});
  if(!assunto) return res.status(400).json({error:'Informe o assunto.'});
  if(!mensagem) return res.status(400).json({error:'Informe a mensagem.'});

  const attachments = anexos
   .filter(a=>a && a.filename && a.content)
   .slice(0,3)
   .map(a=>({filename:String(a.filename).slice(0,120),content:String(a.content)}));

  const response = await fetch('https://api.resend.com/emails', {
   method:'POST',
   headers:{
    'Authorization':`Bearer ${RESEND_API_KEY}`,
    'Content-Type':'application/json'
   },
   body:JSON.stringify({
    from:RESEND_FROM_EMAIL,
    to:emails,
    subject:assunto,
    text:mensagem,
    attachments
   })
  });

  const body=await response.json().catch(()=>({}));

  if(!response.ok){
   console.error('Erro ao enviar mensagem administrativa:', body);
   return res.status(response.status).json({error:'Erro ao enviar mensagem.',details:body});
  }

  try{
   await getSupabase().from('email_envios').insert({
    destinatarios:emails,
    assunto,
    mensagem,
    anexos_nomes:attachments.map(a=>a.filename),
    enviado_em:new Date().toISOString()
   });
  }catch(e){
   console.warn('Não foi possível registrar histórico de envio:', e.message||e);
  }

  res.json({ok:true,total:emails.length,response:body});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message||'Erro ao enviar mensagem.'});
 }
});


app.get('/admin/eventos', async (req, res) => {
  try {
    if (!admin(req, res)) return;
    const sb = getSupabase();
    const { data, error } = await sb
      .from('eventos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json({ ok: true, eventos: data || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Erro ao listar eventos.' });
  }
});

app.patch('/admin/eventos/:id', async (req, res) => {
  try {
    if (!admin(req, res)) return;
    const allowed = [
      'status_publicacao',
      'status_pagamento',
      'status_operacao',
      'titulo_publicado',
      'descricao_publicada',
      'categoria_evento',
      'classificacao_etaria',
      'modalidade_evento',
      'abrangencia_divulgacao',
      'paises_divulgacao',
      'site_oficial',
      'link_ingressos',
      'link_inscricao',
      'link_programacao',
      'link_acessibilidade',
      'data_evento',
      'duracao_horas',
      'max_ouvintes',
      'max_ouvintes_extra',
      'margem_transmissao_minutos',
      'tipo_servico',
      'tipo_evento',
      'divulgar_acesso_ouvintes',
      'pais',
      'uf',
      'origem_transmissao',
      'status_agenda',
      'observacao_agenda',
      'moeda_pagamento',
      'valor_original',
      'cupom_codigo',
      'desconto_aplicado',
      'valor_final',
      'valor_sugerido_agenda',
      'valor_final_agenda',
      'valor_agenda_definido_por_admin',
      'local_evento','local_nome','local_endereco','google_place_id','local_pais_codigo','local_unidade_codigo',
      'latitude',
      'longitude',
      'pais_codigo',
      'unidade_codigo',
      'timezone',
      'cidade',
      'sala_codigo',
      'senha_transmissor',
      'exigir_gps_ouvintes',
      'gps_raio_metros',
      'gps_precisao_max_metros'
    ];
    const update = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
        update[key] = req.body[key];
      }
    }
    ['site_oficial','link_ingressos','link_inscricao','link_programacao','link_acessibilidade'].forEach(k=>{ if(Object.prototype.hasOwnProperty.call(update,k)) update[k]=safeUrl(update[k]); });
    if(Object.prototype.hasOwnProperty.call(update,'categoria_evento')) { const categoria=normalizarCategoriaEvento(update.categoria_evento); if(update.categoria_evento && !categoria) return res.status(400).json({error:'Categoria do evento inválida.'}); update.categoria_evento=categoria; }
    if(Object.prototype.hasOwnProperty.call(update,'classificacao_etaria')) { const classificacao=normalizarClassificacaoEtaria(update.classificacao_etaria); if(update.classificacao_etaria && !classificacao) return res.status(400).json({error:'Classificação etária inválida.'}); update.classificacao_etaria=classificacao; }
    if(Object.prototype.hasOwnProperty.call(update,'modalidade_evento')) update.modalidade_evento=normalizarModalidadeEvento(update.modalidade_evento);
    if(Object.prototype.hasOwnProperty.call(update,'abrangencia_divulgacao')) update.abrangencia_divulgacao=normalizarAbrangenciaDivulgacao(update.abrangencia_divulgacao,update.modalidade_evento||'presencial');
    if(Object.prototype.hasOwnProperty.call(update,'paises_divulgacao')) update.paises_divulgacao=normalizarPaisesDivulgacao(update.paises_divulgacao);
    const alterouAbrangenciaAdmin = Object.prototype.hasOwnProperty.call(update,'abrangencia_divulgacao');
    const alterouPaisesAdmin = Object.prototype.hasOwnProperty.call(update,'paises_divulgacao');
    if(alterouAbrangenciaAdmin && update.abrangencia_divulgacao==='internacional' && alterouPaisesAdmin && !update.paises_divulgacao?.length){
      return res.status(400).json({error:'Selecione pelo menos um país para a divulgação internacional.'});
    }
    // Em atualizações parciais (por exemplo, apenas aprovar ou liberar), não se deve
    // apagar os países já salvos. A lista só é limpa quando a abrangência é
    // explicitamente alterada para um valor diferente de internacional.
    if(alterouAbrangenciaAdmin && update.abrangencia_divulgacao!=='internacional') update.paises_divulgacao=[];
    if(Object.prototype.hasOwnProperty.call(update,'tipo_evento')) update.tipo_evento = text(update.tipo_evento)==='publico'?'publico':'privado';
    if(Object.prototype.hasOwnProperty.call(update,'divulgar_acesso_ouvintes')) update.divulgar_acesso_ouvintes = update.tipo_evento === 'publico' && (update.divulgar_acesso_ouvintes === true || text(update.divulgar_acesso_ouvintes) === 'true');
    if(Object.prototype.hasOwnProperty.call(update,'local_evento')) update.local_evento = limit(update.local_evento,500);
    if(Object.prototype.hasOwnProperty.call(update,'local_nome')) update.local_nome = limit(update.local_nome,200);
    if(Object.prototype.hasOwnProperty.call(update,'local_endereco')) update.local_endereco = limit(update.local_endereco,400);
    if(Object.prototype.hasOwnProperty.call(update,'google_place_id')) update.google_place_id = limit(update.google_place_id,255);
    if(Object.prototype.hasOwnProperty.call(update,'local_pais_codigo')) update.local_pais_codigo = limit(update.local_pais_codigo,10);
    if(Object.prototype.hasOwnProperty.call(update,'local_unidade_codigo')) update.local_unidade_codigo = limit(update.local_unidade_codigo,30);
    if(Object.prototype.hasOwnProperty.call(update,'latitude')) update.latitude = numeroCoordenada(update.latitude);
    if(Object.prototype.hasOwnProperty.call(update,'longitude')) update.longitude = numeroCoordenada(update.longitude);
    if(Object.prototype.hasOwnProperty.call(update,'valor_sugerido_agenda')) update.valor_sugerido_agenda = valorNumericoOuNull(update.valor_sugerido_agenda);
    if(Object.prototype.hasOwnProperty.call(update,'valor_final_agenda')) update.valor_final_agenda = valorNumericoOuNull(update.valor_final_agenda);
    if(Object.prototype.hasOwnProperty.call(update,'valor_agenda_definido_por_admin')) update.valor_agenda_definido_por_admin = !!update.valor_agenda_definido_por_admin;
    if(Object.prototype.hasOwnProperty.call(update,'pais')) update.pais = text(update.pais);
    if(Object.prototype.hasOwnProperty.call(update,'uf')) update.uf = (update.pais === 'Outros' || update.pais === 'Internacional') ? '' : text(update.uf);
    if(Object.prototype.hasOwnProperty.call(update,'pais_codigo')) update.pais_codigo = limit(update.pais_codigo || codigoPaisMaps(update.pais),10);
    if(Object.prototype.hasOwnProperty.call(update,'unidade_codigo')) update.unidade_codigo = limit(update.unidade_codigo,20);
    const paisParaTimezoneAdmin = update.pais === 'Internacional' ? update.origem_transmissao : update.pais;
    if(Object.prototype.hasOwnProperty.call(update,'pais') || Object.prototype.hasOwnProperty.call(update,'uf') || Object.prototype.hasOwnProperty.call(update,'origem_transmissao') || Object.prototype.hasOwnProperty.call(update,'pais_codigo') || Object.prototype.hasOwnProperty.call(update,'unidade_codigo') || Object.prototype.hasOwnProperty.call(update,'timezone')) update.timezone = timezonePorLocal(update.pais_codigo, update.unidade_codigo, paisParaTimezoneAdmin);
    if(Object.prototype.hasOwnProperty.call(update,'data_evento')) update.data_evento = prepararDataEvento(update.data_evento, update.timezone);
    if(Object.prototype.hasOwnProperty.call(update,'cidade')) update.cidade = limit(update.cidade,120);
    if(Object.prototype.hasOwnProperty.call(update,'sala_codigo')) update.sala_codigo = limit(update.sala_codigo,120);
    if(Object.prototype.hasOwnProperty.call(update,'senha_transmissor')) update.senha_transmissor = limit(update.senha_transmissor,80);
    if(Object.prototype.hasOwnProperty.call(update,'exigir_gps_ouvintes')) update.exigir_gps_ouvintes = update.exigir_gps_ouvintes === true || text(update.exigir_gps_ouvintes) === 'true' || text(update.exigir_gps_ouvintes) === 'sim' || text(update.exigir_gps_ouvintes) === '1';
    if(Object.prototype.hasOwnProperty.call(update,'gps_raio_metros')) {
      const raio = Number(update.gps_raio_metros || 200);
      update.gps_raio_metros = Number.isFinite(raio) ? Math.max(10, Math.min(5000, Math.floor(raio))) : 200;
    }
    if(Object.prototype.hasOwnProperty.call(update,'gps_precisao_max_metros')) {
      const precisao = Number(update.gps_precisao_max_metros || 500);
      update.gps_precisao_max_metros = Number.isFinite(precisao) ? Math.max(10, Math.min(5000, Math.floor(precisao))) : 500;
    }
    if(Object.prototype.hasOwnProperty.call(update,'max_ouvintes_extra')) {
      const extra = Number(update.max_ouvintes_extra || 0);
      update.max_ouvintes_extra = Number.isFinite(extra) ? Math.max(0, Math.min(500, Math.floor(extra))) : 0;
    }
    if(Object.prototype.hasOwnProperty.call(update,'margem_transmissao_minutos')) {
      const margem = Number(update.margem_transmissao_minutos || 15);
      update.margem_transmissao_minutos = Number.isFinite(margem) ? Math.max(0, Math.min(180, Math.floor(margem))) : 15;
    }

    if(Object.prototype.hasOwnProperty.call(update,'status_agenda') && ['disponivel','indisponivel','pendente'].includes(text(update.status_agenda))){
      if(text(update.status_agenda) === 'disponivel'){
        const finalAgenda = valorNumericoOuNull(update.valor_final_agenda);
        if(finalAgenda !== null) update.status_pagamento = finalAgenda > 0 ? 'pendente' : 'dispensado';
      }
      if(text(update.status_agenda) === 'indisponivel') update.status_pagamento = 'cancelado';
    }

    update.editado_por_admin = true;
    update.data_ultima_edicao = new Date().toISOString();

    const sbAdminPatch = getSupabase();
    const { data: eventoAntes, error: eventoAntesError } = await sbAdminPatch
      .from('eventos')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (eventoAntesError) throw eventoAntesError;

    const { data, error } = await sbAdminPatch
      .from('eventos')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    const email_agenda_resultado = await enviarNotificacaoAgendaSeNecessario(eventoAntes, data).catch(err => {
      console.error('Falha ao enviar e-mail de agenda pelo painel:', err);
      return {ok:false,error:String(err && err.message ? err.message : err)};
    });
    const email_publicacao_resultado = await notificarInscritosEventoPublicado(eventoAntes, data).catch(err => {
      console.error('Falha ao notificar inscritos sobre evento publicado:', err);
      return {ok:false,error:String(err && err.message ? err.message : err)};
    });
    res.json({ ok: true, evento: data, email_agenda_resultado, email_publicacao_resultado });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Erro ao atualizar evento.' });
  }
});



async function obterConfigDemonstracoes(){
  const {data,error}=await getSupabase().from('configuracao_demonstracoes').select('*').eq('id',1).maybeSingle(); if(error) throw error;
  return data||{id:1,habilitada:false,validade_meses:1,limite_ouvintes:5,duracao_sessao_minutos:30,limite_sessoes:3,limite_geral_pedidos:100,limite_pedidos_email:1,apenas_uma_ativa_email:true,pedidos_utilizados:0};
}
app.get('/admin/demonstracoes/configuracao',async(req,res)=>{if(!admin(req,res))return;try{res.json({ok:true,config:await obterConfigDemonstracoes()})}catch(e){res.status(500).json({error:e.message})}});
app.put('/admin/demonstracoes/configuracao',async(req,res)=>{if(!admin(req,res))return;try{const b=req.body||{},a=await obterConfigDemonstracoes(),payload={id:1,habilitada:b.habilitada===true,validade_meses:Math.max(1,Math.min(12,Number(b.validade_meses||1))),limite_ouvintes:Math.max(1,Math.min(20,Number(b.limite_ouvintes||5))),duracao_sessao_minutos:Math.max(20,Math.min(120,Number(b.duracao_sessao_minutos||30))),limite_sessoes:Math.max(1,Math.min(10,Number(b.limite_sessoes||3))),limite_geral_pedidos:Math.max(1,Math.min(1000,Number(b.limite_geral_pedidos||100))),limite_pedidos_email:Math.max(1,Math.min(10,Number(b.limite_pedidos_email||1))),apenas_uma_ativa_email:b.apenas_uma_ativa_email!==false,pedidos_utilizados:Number(a.pedidos_utilizados||0),updated_at:new Date().toISOString()};const {data,error}=await getSupabase().from('configuracao_demonstracoes').upsert(payload).select().single();if(error)throw error;res.json({ok:true,config:data})}catch(e){res.status(500).json({error:e.message})}});
app.post('/admin/demonstracoes/zerar-contador-geral',async(req,res)=>{if(!admin(req,res))return;try{const {error}=await getSupabase().from('configuracao_demonstracoes').update({pedidos_utilizados:0,updated_at:new Date().toISOString()}).eq('id',1);if(error)throw error;res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
app.post('/admin/demonstracoes/zerar-contador-email',async(req,res)=>{if(!admin(req,res))return;try{const email=String((req.body||{}).email||'').trim().toLowerCase();if(!email)return res.status(400).json({error:'Informe o e-mail.'});const {error}=await getSupabase().from('demonstracao_contadores_email').upsert({email,pedidos_utilizados:0,updated_at:new Date().toISOString()});if(error)throw error;res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
app.get('/admin/demonstracoes/email-contador',async(req,res)=>{if(!admin(req,res))return;try{const email=String(req.query.email||'').trim().toLowerCase();const {data,error}=await getSupabase().from('demonstracao_contadores_email').select('*').eq('email',email).maybeSingle();if(error)throw error;res.json({ok:true,contador:data||{email,pedidos_utilizados:0,ultimo_pedido_em:null}})}catch(e){res.status(500).json({error:e.message})}});
app.get('/admin/demonstracoes',async(req,res)=>{if(!admin(req,res))return;try{const q=String(req.query.q||'').trim().replace(/[%_,]/g,'');let query=getSupabase().from('salas_demonstracao').select('*').order('criada_em',{ascending:false}).limit(500);if(q)query=query.or(`email.ilike.%${q}%,sala_codigo.ilike.%${q}%`);const {data,error}=await query;if(error)throw error;res.json({ok:true,demonstracoes:data||[]})}catch(e){res.status(500).json({error:e.message})}});
app.post('/admin/demonstracoes',async(req,res)=>{if(!admin(req,res))return;try{const b=req.body||{},email=String(b.email||'').trim().toLowerCase();if(!email||!email.includes('@'))return res.status(400).json({error:'Informe um e-mail válido.'});const cfg=await obterConfigDemonstracoes(),sb=getSupabase(),sala=await gerarSalaUnica(sb),senha=await gerarSenhaUnica(sb),agora=new Date(),expira=new Date(agora);expira.setMonth(expira.getMonth()+Number(cfg.validade_meses||1));const payload={nome:limit(b.nome,120)||null,email,sala_codigo:sala,senha_transmissor:senha,origem:'manual',criada_em:agora.toISOString(),expira_em:expira.toISOString(),limite_ouvintes:cfg.limite_ouvintes,duracao_sessao_minutos:cfg.duracao_sessao_minutos,limite_sessoes:cfg.limite_sessoes,sessoes_utilizadas:0,ativa:true,bloqueada:false,updated_at:agora.toISOString()};const {data,error}=await sb.from('salas_demonstracao').insert(payload).select().single();if(error)throw error;const {data:c}=await sb.from('demonstracao_contadores_email').select('*').eq('email',email).maybeSingle();await sb.from('demonstracao_contadores_email').upsert({email,pedidos_utilizados:Number(c&&c.pedidos_utilizados||0)+1,ultimo_pedido_em:agora.toISOString(),updated_at:agora.toISOString()});await sb.from('configuracao_demonstracoes').update({pedidos_utilizados:Number(cfg.pedidos_utilizados||0)+1,updated_at:agora.toISOString()}).eq('id',1);res.json({ok:true,demonstracao:data})}catch(e){res.status(500).json({error:e.message})}});
app.patch('/admin/demonstracoes/:id',async(req,res)=>{if(!admin(req,res))return;try{const b=req.body||{},patch={updated_at:new Date().toISOString()};if('bloqueada'in b)patch.bloqueada=!!b.bloqueada;if('ativa'in b)patch.ativa=!!b.ativa;if(b.renovar_meses){const {data:at,error:ae}=await getSupabase().from('salas_demonstracao').select('*').eq('id',req.params.id).single();if(ae)throw ae;const base=new Date(at.expira_em)>new Date()?new Date(at.expira_em):new Date();base.setMonth(base.getMonth()+Math.max(1,Math.min(12,Number(b.renovar_meses))));patch.expira_em=base.toISOString();}const {data,error}=await getSupabase().from('salas_demonstracao').update(patch).eq('id',req.params.id).select().single();if(error)throw error;res.json({ok:true,demonstracao:data})}catch(e){res.status(500).json({error:e.message})}});
app.delete('/admin/demonstracoes/:id',async(req,res)=>{if(!admin(req,res))return;try{const {error}=await getSupabase().from('salas_demonstracao').delete().eq('id',req.params.id);if(error)throw error;res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
app.get('/public/demonstracoes/configuracao',async(req,res)=>{try{const c=await obterConfigDemonstracoes();res.json({ok:true,habilitada:c.habilitada===true})}catch(e){res.status(500).json({error:e.message})}});



app.get('/token', async (req,res)=>{
 try{
  const room = limit(req.query.room || req.query.sala, 120);
  const role = normalizarRoleToken(req.query.role || req.query.papel);
  const identity = normalizarIdentityToken(req.query.identity || req.query.nome, role);
  const password = String(req.query.password || req.query.senha || '').trim();
  if(!room) return res.status(400).json({error:'Código da sala não informado.'});
  const sb = getSupabase();
  let ev = await buscarEventoOuPlanilhaPorSala(sb, room, 'id,titulo_original,titulo_publicado,sala_codigo,senha_transmissor,status_operacao,status_publicacao,max_ouvintes,duracao_horas,data_evento,latitude,longitude,exigir_gps_ouvintes,gps_raio_metros,gps_precisao_max_metros', {password});
  if(!ev) return res.status(404).json({error:'Sala não encontrada no Audesc.', sala_consultada: room});
  const liberado = String(ev.status_operacao || '').toLowerCase() === 'liberado' || String(ev.status_publicacao || '').toLowerCase() === 'aprovado';
  if(!liberado) return res.status(403).json({error:'Esta sala ainda não está liberada.'});
  const acessoAdmin = role === 'transmitter' && senhaAdminValida(password);
  if(role === 'transmitter'){
    const senhaOficial = String(ev.senha_transmissor || '').trim();
    if(!senhaOficial && !acessoAdmin) return res.status(403).json({error:'A sala ainda não possui senha de transmissor.'});
    if(!acessoAdmin && password !== senhaOficial) return res.status(403).json({error:'Senha do transmissor inválida.'});
    if(ev.tipo_sala==='demonstracao') ev=await iniciarSessaoDemonstracao(sb,ev);
  }
  if(role === 'receiver'){
    if(ev.tipo_sala==='demonstracao'){ const d=ev.demonstracao||{}; const inicio=d.sessao_atual_iniciada_em?new Date(d.sessao_atual_iniciada_em):null; const ativa=inicio&&!d.sessao_atual_encerrada_em&&new Date(inicio.getTime()+Number(d.duracao_sessao_minutos||0)*60000)>new Date(); if(!ativa) return res.status(403).json({error:'A demonstração ainda não possui uma sessão de transmissão ativa.'}); }
    const gps = validarGpsOuvinte(ev, req.query || {});
    if(!gps.ok) return res.status(403).json({error:gps.error || 'Entrada não autorizada pela localização.', gps});
  }
  const tokenIdentity = role === 'transmitter'
    ? `${identity}-${crypto.randomBytes(3).toString('hex')}`
    : identity;
  const token = gerarLiveKitToken({room: ev.sala_codigo || room, identity: tokenIdentity, role});
  res.json({
    ok:true,
    token,
    room: ev.sala_codigo || room,
    role,
    identity: tokenIdentity,
    nome_informado: identity,
    acesso: acessoAdmin ? 'admin' : 'padrao',
    evento: ev.titulo_publicado || ev.titulo_original || 'Evento Audesc',
    origem_sala: ev.origem || 'supabase',
    tipo_sala: ev.tipo_sala || 'evento',
    origem_token:'audesc-events-api',
    gps: gpsConfigEvento(ev)
  });
 }catch(e){
  console.error('Erro ao gerar token LiveKit:', e);
  res.status(500).json({error:e.message || 'Erro ao gerar token de transmissão.'});
 }
});


app.get('/public/salas/:sala/controle-presenca', async (req,res)=>{
 try{
  const sala = limit(req.params.sala,120);
  if(!sala) return res.status(400).json({error:'Código da sala não informado.'});
  const data = await buscarEventoOuPlanilhaPorSala(getSupabase(), sala, 'id,titulo_original,titulo_publicado,sala_codigo,latitude,longitude,local_evento,exigir_gps_ouvintes,gps_raio_metros,gps_precisao_max_metros,status_operacao,created_at');
  if(!data) return res.status(404).json({error:'Sala não encontrada.', sala_consultada:sala});
  const cfg = gpsConfigEvento(data);
  res.json({
    ok:true,
    sala_codigo:data.sala_codigo || sala,
    evento:data.titulo_publicado || data.titulo_original || 'Evento Audesc',
    local_evento:data.local_evento || '',
    exigir_gps_ouvintes:cfg.exigir,
    gps_configurado:cfg.configurado,
    gps_raio_metros:cfg.raio_metros,
    gps_precisao_max_metros:cfg.precisao_max_metros,
    latitude:cfg.exigir ? cfg.latitude : null,
    longitude:cfg.exigir ? cfg.longitude : null,
    status_operacao:data.status_operacao || null
  });
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao consultar controle de presença.'})}
});

app.get('/public/salas/:sala/limite-ouvintes', async (req,res)=>{
 try{
  const sala = limit(req.params.sala,120);
  if(!sala) return res.status(400).json({error:'Código da sala não informado.'});
  const data = await buscarEventoOuPlanilhaPorSala(getSupabase(), sala, 'id,titulo_original,titulo_publicado,sala_codigo,max_ouvintes,max_ouvintes_extra,status_operacao,created_at');
  if(!data) return res.status(404).json({error:'Sala não encontrada.', sala_consultada:sala});
  const max = Number(data.max_ouvintes || 0);
  const extra = Number(data.max_ouvintes_extra || 0);
  const limite = max > 0 ? Math.max(1, Math.floor(max + Math.max(0, extra))) : null;
  res.json({
    ok:true,
    sala_codigo:data.sala_codigo,
    evento:data.titulo_publicado || data.titulo_original || 'Evento Audesc',
    max_ouvintes:max || null,
    max_ouvintes_extra:Math.max(0, Math.floor(extra || 0)),
    limite_ouvintes:limite,
    status_operacao:data.status_operacao || null
  });
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao consultar limite de ouvintes.'})}
});


function calcularJanelaTransmissaoEvento(ev){
  const margem = Number.isFinite(Number(ev && ev.margem_transmissao_minutos)) ? Math.max(0, Math.min(180, Math.floor(Number(ev.margem_transmissao_minutos)))) : 15;
  const duracaoHoras = Number(ev && ev.duracao_horas);
  const inicio = ev && ev.data_evento ? new Date(ev.data_evento) : null;
  if(!inicio || Number.isNaN(inicio.getTime()) || !Number.isFinite(duracaoHoras) || duracaoHoras <= 0){
    return {margem, configurado:false, inicio:null, liberacao:null, termino:null, encerramento:null};
  }
  const termino = new Date(inicio.getTime() + duracaoHoras * 60 * 60 * 1000);
  const liberacao = new Date(inicio.getTime() - margem * 60 * 1000);
  const encerramento = new Date(termino.getTime() + margem * 60 * 1000);
  return {margem, configurado:true, inicio, liberacao, termino, encerramento};
}
function statusJanelaTransmissao(ev){
  const janela = calcularJanelaTransmissaoEvento(ev);
  const agora = new Date();
  if(!janela.configurado){
    return {
      ok:true,
      configurado:false,
      permitido_entrar:true,
      permitido_permanecer:true,
      margem_transmissao_minutos:janela.margem,
      mensagem:'Janela de transmissão não configurada para este evento.'
    };
  }
  const antes = agora.getTime() < janela.liberacao.getTime();
  const depois = agora.getTime() > janela.encerramento.getTime();
  const minutos_ate_liberacao = antes ? Math.ceil((janela.liberacao.getTime() - agora.getTime()) / 60000) : 0;
  const minutos_restantes = Math.max(0, Math.ceil((janela.encerramento.getTime() - agora.getTime()) / 60000));
  return {
    ok:true,
    configurado:true,
    permitido_entrar:!antes && !depois,
    permitido_permanecer:!depois,
    antes_da_liberacao:antes,
    apos_encerramento:depois,
    margem_transmissao_minutos:janela.margem,
    inicio_evento:janela.inicio.toISOString(),
    liberacao_transmissao:janela.liberacao.toISOString(),
    termino_evento:janela.termino.toISOString(),
    encerramento_transmissao:janela.encerramento.toISOString(),
    minutos_ate_liberacao,
    minutos_restantes,
    mensagem: antes
      ? `A transmissão será liberada em aproximadamente ${minutos_ate_liberacao} minuto(s).`
      : depois
        ? 'A janela de transmissão deste evento foi encerrada.'
        : `Restam ${minutos_restantes} minuto(s) para o encerramento da transmissão.`
  };
}

app.get('/public/salas/:sala/janela-transmissao', async (req,res)=>{
 try{
  const sala = limit(req.params.sala,120);
  if(!sala) return res.status(400).json({error:'Código da sala não informado.'});
  const data = await buscarEventoOuPlanilhaPorSala(getSupabase(), sala, 'id,titulo_original,titulo_publicado,sala_codigo,data_evento,duracao_horas,margem_transmissao_minutos,status_operacao,created_at');
  if(!data) return res.status(404).json({error:'Sala não encontrada.', sala_consultada:sala});
  const status = statusJanelaTransmissao(data);
  res.json(Object.assign(status, {
    sala_codigo:data.sala_codigo,
    evento:data.titulo_publicado || data.titulo_original || 'Evento Audesc',
    status_operacao:data.status_operacao || null
  }));
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao consultar janela de transmissão.'})}
});



// Fase 6.13 - Avaliacao pos-transmissao
const AVALIACAO_PADRAO = {ativa:true,prazo_minutos:60,participacao_minima_minutos:1,permitir_edicao:true,comentario_ativo:true};
async function obterConfigAvaliacao(){
  try{
    const {data,error}=await getSupabase().from('configuracao_avaliacoes').select('*').eq('id',1).maybeSingle();
    if(error) throw error;
    return Object.assign({},AVALIACAO_PADRAO,data||{});
  }catch(e){ return Object.assign({},AVALIACAO_PADRAO); }
}
function idOuvinteValido(v){ return /^[a-zA-Z0-9_-]{16,100}$/.test(String(v||'')); }

app.post('/public/salas/:sala/participacao', async (req,res)=>{
 try{
  const sala=limit(req.params.sala,120), b=req.body||{}, ouvinte_id=limit(b.ouvinte_id,100);
  if(!sala || !idOuvinteValido(ouvinte_id)) return res.status(400).json({error:'Identificacao de participacao invalida.'});
  const ev=await buscarEventoOuPlanilhaPorSala(getSupabase(),sala,'id,sala_codigo,status_operacao,status_publicacao');
  if(!ev) return res.status(404).json({error:'Sala nao encontrada.'});
  const agora=new Date().toISOString();
  const sb=getSupabase();
  const {data:existente}=await sb.from('participacoes_transmissoes').select('*').eq('evento_id',ev.id).eq('ouvinte_id',ouvinte_id).maybeSingle();
  const entrada=existente&&existente.primeira_entrada ? existente.primeira_entrada : agora;
  const payload={evento_id:ev.id,sala_codigo:ev.sala_codigo||sala,ouvinte_id,nome_ouvinte:limit(b.nome_ouvinte,120),primeira_entrada:entrada,ultima_atividade:agora,ultima_saida:null,reconexoes:Math.max(0,Number(existente&&existente.reconexoes||0)+(existente?1:0))};
  const {error}=await sb.from('participacoes_transmissoes').upsert(payload,{onConflict:'evento_id,ouvinte_id'}); if(error) throw error;
  res.json({ok:true,registrado:true});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao registrar participacao.'})}
});
app.post('/public/salas/:sala/participacao/atividade', async (req,res)=>{
 try{
  const sala=limit(req.params.sala,120), b=req.body||{}, ouvinte_id=limit(b.ouvinte_id,100);
  if(!sala || !idOuvinteValido(ouvinte_id)) return res.status(400).json({error:'Identificacao invalida.'});
  const {error}=await getSupabase().from('participacoes_transmissoes').update({ultima_atividade:new Date().toISOString()}).eq('sala_codigo',sala).eq('ouvinte_id',ouvinte_id); if(error) throw error;
  res.json({ok:true});
 }catch(e){res.status(500).json({error:e.message||'Erro ao atualizar participacao.'})}
});
app.post('/public/salas/:sala/participacao/saida', async (req,res)=>{
 try{ const sala=limit(req.params.sala,120), id=limit((req.body||{}).ouvinte_id,100); if(!idOuvinteValido(id)) return res.status(400).json({error:'Identificacao invalida.'});
  const agora=new Date().toISOString(); const {error}=await getSupabase().from('participacoes_transmissoes').update({ultima_atividade:agora,ultima_saida:agora}).eq('sala_codigo',sala).eq('ouvinte_id',id); if(error) throw error; res.json({ok:true});
 }catch(e){res.status(500).json({error:e.message||'Erro ao registrar saida.'})}
});
app.post('/salas/:sala/encerrar-transmissao', async (req,res)=>{
 try{
  const sala=limit(req.params.sala,120), senha=String((req.body||{}).senha||'').trim();
  const ev=await buscarEventoOuPlanilhaPorSala(getSupabase(),sala,'id,sala_codigo,senha_transmissor,titulo_original,titulo_publicado');
  if(!ev) return res.status(404).json({error:'Sala nao encontrada.'});
  if(!senhaAdminValida(senha) && senha!==String(ev.senha_transmissor||'')) return res.status(403).json({error:'Senha do transmissor invalida.'});
  const cfg=await obterConfigAvaliacao(), fim=new Date(), expira=new Date(fim.getTime()+Math.max(15,Number(cfg.prazo_minutos||60))*60000);
  const sb=getSupabase();
  if(ev.tipo_sala==='demonstracao' && ev.demonstracao){ const {error:de}=await sb.from('salas_demonstracao').update({sessao_atual_encerrada_em:fim.toISOString(),updated_at:fim.toISOString()}).eq('id',ev.id); if(de) throw de; }
  const {error:se}=await sb.from('sessoes_avaliacao').upsert({evento_id:ev.id,sala_codigo:ev.sala_codigo||sala,encerrada_em:fim.toISOString(),avaliacao_expira_em:expira.toISOString(),avaliacao_ativa:cfg.ativa!==false},{onConflict:'evento_id'}); if(se) throw se;
  let elegiveis=0;
  if(cfg.ativa!==false){
    const {data:parts,error:pe}=await sb.from('participacoes_transmissoes').select('*').eq('evento_id',ev.id).lte('primeira_entrada',fim.toISOString()); if(pe) throw pe;
    const minMs=Math.max(0,Number(cfg.participacao_minima_minutos||1))*60000;
    const rows=(parts||[]).filter(p=> Math.max(0,fim.getTime()-new Date(p.primeira_entrada).getTime())>=minMs).map(p=>({evento_id:ev.id,sala_codigo:ev.sala_codigo||sala,ouvinte_id:p.ouvinte_id,elegivel:true,definido_em:fim.toISOString(),expira_em:expira.toISOString()}));
    if(rows.length){ const {error:ee}=await sb.from('elegibilidade_avaliacoes').upsert(rows,{onConflict:'evento_id,ouvinte_id'}); if(ee) throw ee; elegiveis=rows.length; }
  }
  res.json({ok:true,avaliacao_ativa:cfg.ativa!==false,elegiveis,encerrada_em:fim.toISOString(),expira_em:expira.toISOString(),prazo_minutos:Number(cfg.prazo_minutos||60)});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao encerrar transmissao.'})}
});
app.get('/public/salas/:sala/avaliacao/status', async (req,res)=>{
 try{
  const sala=limit(req.params.sala,120), id=limit(req.query.ouvinte_id,100); if(!idOuvinteValido(id)) return res.status(400).json({error:'Identificacao invalida.'});
  const sb=getSupabase(); const {data:el,error}=await sb.from('elegibilidade_avaliacoes').select('*').eq('sala_codigo',sala).eq('ouvinte_id',id).maybeSingle(); if(error) throw error;
  if(!el) return res.json({ok:true,encerrada:false,elegivel:false,disponivel:false});
  const expirou=new Date(el.expira_em).getTime()<Date.now(); const {data:av}=await sb.from('avaliacoes_transmissoes').select('*').eq('evento_id',el.evento_id).eq('ouvinte_id',id).maybeSingle();
  res.json({ok:true,encerrada:true,elegivel:!!el.elegivel,disponivel:!!el.elegivel&&!expirou,expirou,expira_em:el.expira_em,avaliacao:av||null});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao consultar avaliacao.'})}
});
app.post('/public/salas/:sala/avaliacao', async (req,res)=>{
 try{
  const sala=limit(req.params.sala,120), b=req.body||{}, id=limit(b.ouvinte_id,100); if(!idOuvinteValido(id)) return res.status(400).json({error:'Identificacao invalida.'});
  const sb=getSupabase(); const {data:el,error}=await sb.from('elegibilidade_avaliacoes').select('*').eq('sala_codigo',sala).eq('ouvinte_id',id).maybeSingle(); if(error) throw error;
  if(!el||!el.elegivel) return res.status(403).json({error:'Somente ouvintes presentes antes do encerramento podem avaliar.'});
  if(new Date(el.expira_em).getTime()<Date.now()) return res.status(410).json({error:'O periodo de avaliacao foi encerrado.'});
  const geral=Number(b.avaliacao_geral), ad=Number(b.qualidade_audiodescricao), audio=Number(b.qualidade_audio), autonomia=Number(b.autonomia), rec=b.recomendacao===''||b.recomendacao==null?null:Number(b.recomendacao);
  if(![geral,ad,audio,autonomia].every(n=>Number.isInteger(n)&&n>=1&&n<=5)) return res.status(400).json({error:'Preencha todas as avaliacoes obrigatorias.'});
  if(rec!==null && (!Number.isInteger(rec)||rec<0||rec>10)) return res.status(400).json({error:'A recomendacao deve estar entre 0 e 10.'});
  const payload={evento_id:el.evento_id,sala_codigo:sala,ouvinte_id:id,avaliacao_geral:geral,qualidade_audiodescricao:ad,qualidade_audio:audio,autonomia,recomendacao:rec,comentario:limit(b.comentario,1000),atualizada_em:new Date().toISOString()};
  const {error:ae}=await sb.from('avaliacoes_transmissoes').upsert(payload,{onConflict:'evento_id,ouvinte_id'}); if(ae) throw ae; res.json({ok:true,mensagem:'Avaliacao registrada com sucesso.'});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao salvar avaliacao.'})}
});
app.get('/admin/avaliacoes/configuracao', async (req,res)=>{if(!admin(req,res))return;res.json({ok:true,config:await obterConfigAvaliacao()})});
app.put('/admin/avaliacoes/configuracao', async (req,res)=>{if(!admin(req,res))return;try{const b=req.body||{},payload={id:1,ativa:b.ativa!==false,prazo_minutos:Math.max(15,Math.min(120,Number(b.prazo_minutos||60))),participacao_minima_minutos:Math.max(0,Math.min(60,Number(b.participacao_minima_minutos||1))),permitir_edicao:b.permitir_edicao!==false,comentario_ativo:b.comentario_ativo!==false,avaliacao_instantanea_ativa:b.avaliacao_instantanea_ativa!==false,comentario_instantaneo_ativo:b.comentario_instantaneo_ativo!==false,updated_at:new Date().toISOString()};const {error}=await getSupabase().from('configuracao_avaliacoes').upsert(payload);if(error)throw error;res.json({ok:true,config:payload})}catch(e){res.status(500).json({error:e.message})}});
app.get('/admin/avaliacoes', async (req,res)=>{if(!admin(req,res))return;try{const {data,error}=await getSupabase().from('avaliacoes_transmissoes').select('*').order('atualizada_em',{ascending:false}).limit(1000);if(error)throw error;res.json({ok:true,avaliacoes:data||[]})}catch(e){res.status(500).json({error:e.message})}});



// Fase 6.14 - Avaliacao instantanea da audiodescricao
const AVALIACAO_INSTANTANEA_PRAZO_MINUTOS = 15;
const AVALIACAO_INSTANTANEA_INTERVALO_MINUTOS = 15;
async function avaliacaoInstantaneaAtiva(){
  try{
    const {data,error}=await getSupabase().from('configuracao_avaliacoes').select('avaliacao_instantanea_ativa,comentario_instantaneo_ativo').eq('id',1).maybeSingle();
    if(error) throw error;
    return {ativa:data?.avaliacao_instantanea_ativa!==false, comentario:data?.comentario_instantaneo_ativo!==false};
  }catch(e){ return {ativa:true,comentario:true}; }
}
app.get('/public/avaliacoes/configuracao', async (req,res)=>{
  try{
    const cfg=await avaliacaoInstantaneaAtiva();
    res.set('Cache-Control','no-store');
    res.json({ok:true,avaliacao_instantanea_ativa:cfg.ativa,comentario_instantaneo_ativo:cfg.comentario});
  }catch(e){
    res.status(500).json({error:e.message||'Erro ao consultar configuracao das avaliacoes.'});
  }
});
app.post('/salas/:sala/avaliacao-instantanea/pedidos', async (req,res)=>{
 try{
  const sala=limit(req.params.sala,120), b=req.body||{}, senha=String(b.senha||'').trim();
  const ev=await buscarEventoOuPlanilhaPorSala(getSupabase(),sala,'id,sala_codigo,senha_transmissor');
  if(!ev) return res.status(404).json({error:'Sala nao encontrada.'});
  if(!senhaAdminValida(senha) && senha!==String(ev.senha_transmissor||'')) return res.status(403).json({error:'Senha do transmissor invalida.'});
  const cfg=await avaliacaoInstantaneaAtiva(); if(!cfg.ativa) return res.status(403).json({error:'A avaliacao instantanea esta desativada.'});
  const sb=getSupabase(), agora=new Date(), limiteAnterior=new Date(agora.getTime()-AVALIACAO_INSTANTANEA_INTERVALO_MINUTOS*60000).toISOString();
  const {data:ultimo,error:ue}=await sb.from('pedidos_avaliacao_audiodescricao').select('*').eq('evento_id',ev.id).gte('criado_em',limiteAnterior).order('criado_em',{ascending:false}).limit(1); if(ue) throw ue;
  if(ultimo&&ultimo.length){ const proximo=new Date(new Date(ultimo[0].criado_em).getTime()+AVALIACAO_INSTANTANEA_INTERVALO_MINUTOS*60000); return res.status(429).json({error:'Aguarde 15 minutos entre os pedidos.',proximo_pedido_em:proximo.toISOString()}); }
  const expira=new Date(agora.getTime()+AVALIACAO_INSTANTANEA_PRAZO_MINUTOS*60000);
  const {data:pedido,error:pe}=await sb.from('pedidos_avaliacao_audiodescricao').insert({evento_id:ev.id,sala_codigo:ev.sala_codigo||sala,solicitado_por:limit(b.solicitado_por,120),criado_em:agora.toISOString(),expira_em:expira.toISOString(),ativo:true}).select('*').single(); if(pe) throw pe;
  const recente=new Date(agora.getTime()-90000).toISOString();
  const {data:parts,error:pae}=await sb.from('participacoes_transmissoes').select('ouvinte_id,nome_ouvinte,ultima_atividade').eq('evento_id',ev.id).gte('ultima_atividade',recente); if(pae) throw pae;
  const rows=(parts||[]).map(p=>({pedido_id:pedido.id,evento_id:ev.id,sala_codigo:ev.sala_codigo||sala,ouvinte_id:p.ouvinte_id,nome_ouvinte:p.nome_ouvinte||'Ouvinte',elegivel:true,definido_em:agora.toISOString()}));
  if(rows.length){ const {error:ee}=await sb.from('elegibilidade_avaliacao_audiodescricao').insert(rows); if(ee) throw ee; }
  res.json({ok:true,pedido_id:pedido.id,expira_em:expira.toISOString(),prazo_minutos:15,elegiveis:rows.length,comentario_ativo:cfg.comentario});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao criar pedido de avaliacao.'})}
});

app.get('/salas/:sala/avaliacao-instantanea/estado-transmissor', async (req,res)=>{
 try{
  const sala=limit(req.params.sala,120), senha=String(req.query.senha||'').trim();
  const ev=await buscarEventoOuPlanilhaPorSala(getSupabase(),sala,'id,sala_codigo,senha_transmissor');
  if(!ev) return res.status(404).json({error:'Sala nao encontrada.'});
  if(!senhaAdminValida(senha) && senha!==String(ev.senha_transmissor||'')) return res.status(403).json({error:'Senha do transmissor invalida.'});
  const cfg=await avaliacaoInstantaneaAtiva();
  if(!cfg.ativa) return res.json({ok:true,ativa:false,pode_solicitar:false});
  const sb=getSupabase();
  const {data:ultimos,error}=await sb.from('pedidos_avaliacao_audiodescricao').select('*').eq('evento_id',ev.id).order('criado_em',{ascending:false}).limit(1);
  if(error) throw error;
  const ultimo=ultimos&&ultimos[0];
  if(!ultimo) return res.json({ok:true,ativa:true,pode_solicitar:true});
  const proximo=new Date(new Date(ultimo.criado_em).getTime()+AVALIACAO_INSTANTANEA_INTERVALO_MINUTOS*60000);
  const pode=proximo.getTime()<=Date.now();
  res.set('Cache-Control','no-store');
  res.json({ok:true,ativa:true,pode_solicitar:pode,proximo_pedido_em:proximo.toISOString(),pedido_atual:{id:ultimo.id,expira_em:ultimo.expira_em,ativo:ultimo.ativo!==false}});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao consultar estado da avaliacao instantanea.'})}
});

app.get('/public/salas/:sala/avaliacao-instantanea/status', async (req,res)=>{
 try{
  const cfg=await avaliacaoInstantaneaAtiva();
  if(!cfg.ativa) return res.json({ok:true,ativa:false,disponivel:false});
  const sala=limit(req.params.sala,120), id=limit(req.query.ouvinte_id,100); if(!idOuvinteValido(id)) return res.status(400).json({error:'Identificacao invalida.'});
  const sb=getSupabase(), agora=new Date().toISOString();
  const {data:els,error}=await sb.from('elegibilidade_avaliacao_audiodescricao').select('*,pedidos_avaliacao_audiodescricao(*)').eq('sala_codigo',sala).eq('ouvinte_id',id).order('definido_em',{ascending:false}).limit(5); if(error) throw error;
  for(const el of (els||[])){
    const p=el.pedidos_avaliacao_audiodescricao; if(!p||!p.ativo||p.expira_em<=agora) continue;
    const {data:av}=await sb.from('avaliacoes_instantaneas_audiodescricao').select('id').eq('pedido_id',p.id).eq('ouvinte_id',id).maybeSingle();
    if(!av) return res.json({ok:true,ativa:true,disponivel:true,pedido_id:p.id,expira_em:p.expira_em,mensagem:'Por gentileza, avalie a minha audiodescricao.'});
  }
  res.json({ok:true,ativa:true,disponivel:false});
 }catch(e){res.status(500).json({error:e.message||'Erro ao consultar pedido.'})}
});
app.post('/public/salas/:sala/avaliacao-instantanea', async (req,res)=>{
 try{
  const sala=limit(req.params.sala,120), b=req.body||{}, id=limit(b.ouvinte_id,100), pedidoId=String(b.pedido_id||'');
  if(!idOuvinteValido(id)||!pedidoId) return res.status(400).json({error:'Dados da avaliacao invalidos.'});
  const nota=Number(b.nota); if(!Number.isInteger(nota)||nota<1||nota>5) return res.status(400).json({error:'Selecione uma nota de 1 a 5.'});
  const sb=getSupabase(); const {data:el,error}=await sb.from('elegibilidade_avaliacao_audiodescricao').select('*,pedidos_avaliacao_audiodescricao(*)').eq('pedido_id',pedidoId).eq('ouvinte_id',id).maybeSingle(); if(error) throw error;
  if(!el||!el.elegivel||el.sala_codigo!==sala) return res.status(403).json({error:'Este ouvinte nao estava elegivel neste pedido.'});
  const p=el.pedidos_avaliacao_audiodescricao; if(!p||!p.ativo||new Date(p.expira_em).getTime()<Date.now()) return res.status(410).json({error:'O prazo deste pedido foi encerrado.'});
  const payload={pedido_id:pedidoId,evento_id:el.evento_id,sala_codigo:sala,ouvinte_id:id,nome_ouvinte:el.nome_ouvinte||limit(b.nome_ouvinte,120)||'Ouvinte',nota,comentario:limit(b.comentario,500),criado_em:new Date().toISOString()};
  const {error:ie}=await sb.from('avaliacoes_instantaneas_audiodescricao').insert(payload); if(ie){ if(String(ie.code)==='23505') return res.status(409).json({error:'Voce ja respondeu a este pedido.'}); throw ie; }
  const {data:todas,error:te}=await sb.from('avaliacoes_instantaneas_audiodescricao').select('nota').eq('pedido_id',pedidoId); if(te) throw te;
  const notas=(todas||[]).map(x=>Number(x.nota)); const media=notas.length?notas.reduce((a,n)=>a+n,0)/notas.length:0;
  res.json({ok:true,mensagem:'Avaliacao enviada ao audiodescritor.',media:Number(media.toFixed(2)),quantidade:notas.length});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao salvar avaliacao.'})}
});
app.get('/salas/:sala/avaliacao-instantanea/resumo', async (req,res)=>{
 try{
  const sala=limit(req.params.sala,120), senha=String(req.query.senha||'').trim(), pedidoId=String(req.query.pedido_id||'');
  const ev=await buscarEventoOuPlanilhaPorSala(getSupabase(),sala,'id,sala_codigo,senha_transmissor'); if(!ev)return res.status(404).json({error:'Sala nao encontrada.'});
  if(!senhaAdminValida(senha)&&senha!==String(ev.senha_transmissor||''))return res.status(403).json({error:'Senha invalida.'});
  const sb=getSupabase(); let q=sb.from('avaliacoes_instantaneas_audiodescricao').select('*').eq('evento_id',ev.id).order('criado_em',{ascending:true}); if(pedidoId)q=q.eq('pedido_id',pedidoId); const {data,error}=await q;if(error)throw error;
  const respostas=data||[], dist={1:0,2:0,3:0,4:0,5:0}; respostas.forEach(x=>dist[x.nota]=(dist[x.nota]||0)+1); const media=respostas.length?respostas.reduce((a,x)=>a+Number(x.nota),0)/respostas.length:0;
  const {data:pedidos}=await sb.from('pedidos_avaliacao_audiodescricao').select('*').eq('evento_id',ev.id).order('criado_em',{ascending:false});
  res.json({ok:true,media:Number(media.toFixed(2)),quantidade:respostas.length,distribuicao:dist,respostas,pedidos:pedidos||[]});
 }catch(e){res.status(500).json({error:e.message||'Erro ao consultar avaliacoes.'})}
});

app.get('/public/eventos', async (req,res)=>{
 try{
  const {data,error}=await getSupabase().from('eventos').select('id,tipo_servico,servicos_solicitados,tipo_evento,divulgar_acesso_ouvintes,status_publicacao,status_operacao,titulo_original,titulo_publicado,descricao_original,descricao_publicada,categoria_evento,classificacao_etaria,modalidade_evento,abrangencia_divulgacao,paises_divulgacao,site_oficial,link_ingressos,link_inscricao,link_programacao,link_acessibilidade,data_evento,duracao_horas,max_ouvintes,sala_codigo,pais,uf,pais_codigo,unidade_codigo,timezone,cidade,origem_transmissao,local_evento,latitude,longitude,created_at').eq('status_publicacao','aprovado').order('data_evento',{ascending:true});
  if(error) throw error; res.json({ok:true,eventos:data||[]});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao listar eventos públicos.'})}
});


app.post('/notificacoes/solicitar', async (req,res)=>{
 try{
  const b=req.body||{};
  if(text(b.website)) return res.status(400).json({error:'Solicitação inválida.'});
  const email=text(b.email).toLowerCase();
  if(!email || !email.includes('@')) return res.status(400).json({error:'Informe um e-mail válido.'});
  if(await emailBloqueado(email)) return res.status(403).json({error:'Este e-mail está bloqueado para cadastro de notificações.'});
  const paisNotificacao=text(b.pais);
  const ufNotificacao=text(b.uf);
  const paisCodigoNotificacao=limit(b.pais_codigo || b.paisCodigo || codigoPaisMaps(paisNotificacao),10);
  const unidadeCodigoNotificacao=limit(b.unidade_codigo || b.unidadeCodigo || codigoUnidadeLocal(paisCodigoNotificacao, ufNotificacao, b.ufTexto),20);
  const payload={email,receber_todos:!!b.receber_todos,pais:paisNotificacao,uf:ufNotificacao,pais_codigo:paisCodigoNotificacao,unidade_codigo:unidadeCodigoNotificacao,eventos_ids:Array.isArray(b.eventos_ids)?b.eventos_ids:[],updated_at:new Date().toISOString()};
  const sb=getSupabase();
  const {data:existing,error:findError}=await sb.from('notificacoes').select('*').eq('email',email).maybeSingle();
  if(findError) throw findError;
  if(existing && existing.email_validado===true){
    const {data,error}=await sb.from('notificacoes').update({...payload,ativo:true,email_validado:true}).eq('email',email).select().single();
    if(error) throw error;
    return res.json({ok:true,ja_validado:true,mensagem:'E-mail já validado. Preferências atualizadas.',preferencias:data});
  }
  const {data,error}=await sb.from('notificacoes').upsert({...payload,ativo:false,email_validado:false},{onConflict:'email'}).select().single();
  if(error) throw error;
  res.json({ok:true,ja_validado:false,mensagem:'Preferências salvas. Envie o link de validação.',preferencias:data});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao solicitar notificações.'})}
});

app.post('/notificacoes/ativar', async (req,res)=>{
 try{
  const user=await getUser(req);
  if(!user || !user.email) return res.status(401).json({error:'E-mail não validado.'});
  const email=String(user.email).toLowerCase();
  const {data,error}=await getSupabase().from('notificacoes').update({user_id:user.id,email_validado:true,ativo:true,updated_at:new Date().toISOString()}).eq('email',email).select().single();
  if(error) throw error;
  res.json({ok:true,mensagem:'E-mail validado e notificações ativadas.',preferencias:data});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao ativar notificações.'})}
});


app.delete('/admin/eventos/:id', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const { error } = await getSupabase().from('eventos').delete().eq('id', req.params.id);
  if(error) throw error;
  res.json({ok:true,mensagem:'Evento excluído definitivamente.'});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message||'Erro ao excluir evento.'});
 }
});


app.post('/admin/eventos/:id/reenviar-email', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const {data:ev,error}=await getSupabase().from('eventos').select('*').eq('id',req.params.id).single();
  if(error) throw error;
  if(!ev) return res.status(404).json({error:'Evento não encontrado.'});
  if(!eventoUsaTransmissao(ev)) return res.status(400).json({error:'Este evento não é de transmissão Audesc.'});
  if(!ev.sala_codigo || !ev.senha_transmissor) return res.status(400).json({error:'Evento ainda não possui sala e senha. Libere o evento antes de reenviar o e-mail.'});

  const email_resultado = await enviarEmailLiberacao(ev, ev.senha_transmissor, ev.sala_codigo).catch(err => {
    console.error('Falha inesperada ao reenviar e-mail:', err);
    return { ok:false, error:String(err && err.message ? err.message : err) };
  });
  await registrarResultadoEmail(ev.id, email_resultado);
  res.json({ok:true,email_resultado});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message||'Erro ao reenviar e-mail.'});
 }
});



app.get('/meus-eventos', async (req,res)=>{
 try{
  const user = await getUser(req);
  if(!user || !user.email){
   return res.status(401).json({error:'E-mail não autenticado. Acesse pelo link de validação.'});
  }

  const email = String(user.email || '').trim().toLowerCase();

  const {data,error} = await getSupabase()
   .from('eventos')
   .select('*')
   .eq('email_usuario', email)
   .order('created_at',{ascending:false});

  if(error) throw error;

  const eventos = await sincronizarListaStatusPagamentoDivulgacao(data || []);
  res.json({ok:true,email,total:eventos.length,eventos});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message || 'Erro ao carregar eventos.'});
 }
});






app.get('/pagamentos/mercadopago/config', async (req,res)=>{
 try{
  if(!MERCADOPAGO_PUBLIC_KEY){
   return res.status(500).json({error:'MERCADOPAGO_PUBLIC_KEY não configurada no servidor.'});
  }

  res.json({
   ok:true,
   environment:MERCADOPAGO_ENV,
   public_key:MERCADOPAGO_PUBLIC_KEY
  });
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message || 'Erro ao carregar configuração Mercado Pago.'});
 }
});

app.post('/pagamentos/mercadopago/criar-preferencia', async (req,res)=>{
 try{
  const user = await getUser(req);
  if(!user || !user.email) return res.status(401).json({error:'E-mail não autenticado. Acesse pelo link de validação.'});
  if(!MERCADOPAGO_ACCESS_TOKEN) return res.status(500).json({error:'Mercado Pago ainda não está configurado no servidor.'});

  const eventoId = req.body?.evento_id;
  const codigoCupom = req.body?.cupom || req.body?.cupom_codigo || '';
  if(!eventoId) return res.status(400).json({error:'Evento não informado.'});

  const email = String(user.email).toLowerCase();

  const {data:ev,error} = await getSupabase()
   .from('eventos')
   .select('*')
   .eq('id', eventoId)
   .eq('email_usuario', email)
   .single();

  if(error) throw error;
  if(!ev) return res.status(404).json({error:'Evento não encontrado para este e-mail.'});
  if(ev.status_pagamento === 'pago') return res.json({ok:true,ja_pago:true,mensagem:'Evento já está pago.'});
  if(pagamentoBloqueadoPorAgenda(ev)) return res.status(409).json({error:mensagemAgenda(ev),status_agenda:statusAgendaEvento(ev)});

  const dadosPagamento = await calcularPagamentoEvento(ev, codigoCupom);
  if(dadosPagamento.plataforma_pagamento !== 'mercadopago') return res.status(400).json({error:'Este país está configurado para pagamento por '+(dadosPagamento.plataforma_pagamento||'outra plataforma')+'.'});
  if(!dadosPagamento.pagamentos_ativos || !dadosPagamento.plataforma_disponivel) return res.status(503).json({error:'A integração de pagamento configurada para este país não está disponível.'});
  if(dadosPagamento.valor_final <= 0){
   await registrarDadosPagamentoEvento(ev.id, dadosPagamento, 'mercadopago', 'cupom_integral');
   const { data: pagamentoConfirmado, error: updateError } = await getSupabase().from('eventos').update({
    status_pagamento:'pago',
    pagamento_provedor:'mercadopago',
    pagamento_referencia:'cupom_integral',
    pagamento_confirmado_em:new Date().toISOString(),
    data_ultima_edicao:new Date().toISOString()
   }).eq('id', ev.id).is('pagamento_confirmado_em', null).select().maybeSingle();
   if(updateError) throw updateError;
   if(pagamentoConfirmado){
    await incrementarUsoCupomSeAplicavel(dadosPagamento.cupom_codigo);
    await liberarAutomaticamenteAposPagamento(ev.id);
   }
   return res.json({ok:true,ja_pago:true,cortesia:true,calculo:dadosPagamento,mensagem:'Cupom integral aplicado.'});
  }

  const titulo = ev.titulo_publicado || ev.titulo_original || 'Evento Audesc';
  const pagamentoUrl = `${AUDESC_WEB_URL.replace(/\/$/,'')}/pagamento.html?evento=${encodeURIComponent(ev.id)}`;

  const preferenceBody = {
   items:[
    {
     title: titulo,
     description: 'Publicação e transmissão de audiodescrição ao vivo pelo Audesc',
     quantity: 1,
     currency_id: 'BRL',
     unit_price: dadosPagamento.valor_final
    }
   ],
   payer:{
    email: ev.email_usuario
   },
   external_reference: ev.id,
   metadata:{
    evento_id: ev.id,
    email_usuario: ev.email_usuario,
    origem: 'audesc'
   },
   notification_url: MERCADOPAGO_NOTIFICATION_URL,
   back_urls:{
    success: pagamentoUrl,
    pending: pagamentoUrl,
    failure: pagamentoUrl
   },
   auto_return: 'approved'
  };

  const response = await fetch(MERCADOPAGO_API_BASE + '/checkout/preferences', {
   method:'POST',
   headers:{
    'Authorization':'Bearer '+MERCADOPAGO_ACCESS_TOKEN,
    'Content-Type':'application/json'
   },
   body:JSON.stringify(preferenceBody)
  });

  const body = await response.json().catch(()=>({}));

  if(!response.ok){
   console.error('Erro ao criar preferência Mercado Pago:', body);
   return res.status(response.status).json({error:'Erro ao criar pagamento no Mercado Pago.', details:body});
  }

  await registrarDadosPagamentoEvento(ev.id, dadosPagamento, 'mercadopago', body.id || null);

  const checkoutUrl = MERCADOPAGO_ENV === 'live'
   ? (body.init_point || body.sandbox_init_point || null)
   : (body.sandbox_init_point || body.init_point || null);

  res.json({
   ok:true,
   preference:body,
   checkout_url:checkoutUrl,
   sandbox_checkout_url:body.sandbox_init_point || null,
   init_point:body.init_point || null
  });

 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message || 'Erro ao criar pagamento Mercado Pago.'});
 }
});


app.get('/pagamentos/paddle/config', async (req,res)=>{
 try{
  if(!PADDLE_CLIENT_TOKEN){
   return res.status(500).json({error:'PADDLE_CLIENT_TOKEN não configurado no servidor.'});
  }
  res.json({
   ok:true,
   environment:PADDLE_ENV,
   client_token:PADDLE_CLIENT_TOKEN
  });
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message || 'Erro ao carregar configuração Paddle.'});
 }
});

app.post('/pagamentos/paddle/criar-transacao', async (req,res)=>{
 try{
  const user = await getUser(req);
  if(!user || !user.email) return res.status(401).json({error:'E-mail não autenticado. Acesse pelo link de validação.'});
  if(!PADDLE_API_KEY || !PADDLE_PRICE_ID) return res.status(500).json({error:'Paddle ainda não está configurado no servidor.'});

  const eventoId = req.body?.evento_id;
  const codigoCupom = req.body?.cupom || req.body?.cupom_codigo || '';
  if(!eventoId) return res.status(400).json({error:'Evento não informado.'});

  const email = String(user.email).toLowerCase();
  const {data:ev,error} = await getSupabase().from('eventos').select('*').eq('id', eventoId).eq('email_usuario', email).single();
  if(error) throw error;
  if(!ev) return res.status(404).json({error:'Evento não encontrado para este e-mail.'});
  if(ev.status_pagamento === 'pago') return res.json({ok:true,ja_pago:true,mensagem:'Evento já está pago.'});
  if(pagamentoBloqueadoPorAgenda(ev)) return res.status(409).json({error:mensagemAgenda(ev),status_agenda:statusAgendaEvento(ev)});

  const dadosPagamento = await calcularPagamentoEvento(ev, codigoCupom);
  if(dadosPagamento.plataforma_pagamento !== 'paddle') return res.status(400).json({error:'Este país está configurado para pagamento por '+(dadosPagamento.plataforma_pagamento||'outra plataforma')+'.'});
  if(!dadosPagamento.pagamentos_ativos || !dadosPagamento.plataforma_disponivel) return res.status(503).json({error:'A integração Paddle ou a moeda configurada não está disponível para este país.'});

  if(dadosPagamento.valor_final <= 0){
   await registrarDadosPagamentoEvento(ev.id, dadosPagamento, 'paddle', 'cupom_integral');
   const { data: pagamentoConfirmado, error: updateError } = await getSupabase().from('eventos').update({
    status_pagamento:'pago',
    pagamento_provedor:'paddle',
    pagamento_referencia:'cupom_integral',
    pagamento_confirmado_em:new Date().toISOString(),
    data_ultima_edicao:new Date().toISOString()
   }).eq('id', ev.id).is('pagamento_confirmado_em', null).select().maybeSingle();
   if(updateError) throw updateError;
   if(pagamentoConfirmado){
    await incrementarUsoCupomSeAplicavel(dadosPagamento.cupom_codigo);
    await liberarAutomaticamenteAposPagamento(ev.id);
   }
   return res.json({ok:true,ja_pago:true,cortesia:true,calculo:dadosPagamento,mensagem:'Cupom integral aplicado.'});
  }

  const response = await fetch(PADDLE_API_BASE + '/transactions', {
   method:'POST',
   headers:{'Authorization':'Bearer '+PADDLE_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({
    items:[{
     price:{
      name:'Evento Audesc',
      description:'Publicação e transmissão de audiodescrição ao vivo pelo Audesc',
      product:{
       name:'Evento Audesc',
       tax_category:'saas'
      },
      unit_price:{
       amount:valorMenorUnidade(dadosPagamento.valor_final),
       currency_code:dadosPagamento.moeda
      }
     },
     quantity:1
    }],
    custom_data:{
     evento_id:ev.id,
     email_usuario:ev.email_usuario,
     origem:'audesc',
     moeda:dadosPagamento.moeda,
     valor_original:dadosPagamento.valor_original,
     valor_final:dadosPagamento.valor_final,
     cupom_codigo:dadosPagamento.cupom_codigo
    }
   })
  });

  const body = await response.json().catch(()=>({}));
  if(!response.ok){
   console.error('Erro ao criar transação Paddle:', body);
   return res.status(response.status).json({error:'Erro ao criar pagamento no Paddle.', details:body});
  }

  const tx = body.data || body;
  const checkoutUrl = tx.checkout?.url || tx.checkout_url || tx.url || null;

  await registrarDadosPagamentoEvento(ev.id, dadosPagamento, 'paddle', tx.id || null);

  res.json({ok:true,transaction:tx,checkout_url:checkoutUrl,calculo:dadosPagamento});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message || 'Erro ao criar transação Paddle.'});
 }
});



async function liberarAutomaticamenteAposPagamento(eventoId){
  const sb = getSupabase();

  const { data: ev, error } = await sb.from('eventos').select('*').eq('id', eventoId).single();
  if(error) throw error;
  if(!ev) throw new Error('Evento não encontrado para liberação automática.');

  if(!eventoUsaTransmissao(ev)){
    console.log('PÓS-PAGAMENTO: evento não é de transmissão Audesc. Não será gerada sala.', eventoId);
    return { ok:false, skipped:true, reason:'Evento não é de transmissão Audesc.' };
  }

  if(ev.status_operacao === 'liberado' && ev.sala_codigo && ev.senha_transmissor){
    console.log('PÓS-PAGAMENTO: evento já estava liberado. Dados oficiais mantidos:', ev.sala_codigo);
    return { ok:true, already_liberated:true, evento:ev, sala_codigo:ev.sala_codigo, senha_transmissor:ev.senha_transmissor };
  }

  const { senha, sala } = await gerarCredenciaisTransmissao(ev, sb);

  // A ordem oficial passa a existir primeiro no Supabase/Audesc.
  // A planilha Google é sincronização auxiliar e não deve bloquear a liberação após pagamento.
  const { data: up, error: er } = await sb.from('eventos').update({
    status_publicacao: ev.status_publicacao || 'aprovado',
    status_pagamento: 'pago',
    status_operacao: 'liberado',
    senha_transmissor: senha,
    sala_codigo: sala,
    planilha_liberacao_status: 'pendente',
    planilha_liberacao_erro: null,
    data_ultima_edicao: new Date().toISOString()
  }).eq('id', eventoId).select().single();

  if(er) throw er;

  try{
    await appendSheet(up, senha, sala);
    await atualizarStatusPlanilhaLiberacao(sb, up.id, 'sincronizado', null);
    console.log('PÓS-PAGAMENTO: ordem sincronizada com a planilha:', eventoId, sala);
  }catch(planilhaErro){
    const msg = String(planilhaErro && planilhaErro.message ? planilhaErro.message : planilhaErro);
    await atualizarStatusPlanilhaLiberacao(sb, up.id, 'erro', msg);
    console.warn('PÓS-PAGAMENTO: ordem gerada no Audesc, mas não sincronizada com a planilha:', msg);
  }

  let email_resultado = { ok:false, skipped:true, reason:'E-mail não enviado.' };

  try{
    const { data: oficial } = await sb.from('eventos').select('*').eq('id', eventoId).single();
    const evEmail = oficial || up;

    if(evEmail.email_liberacao_status === 'enviado'){
      email_resultado = { ok:false, skipped:true, reason:'E-mail de liberação já havia sido enviado.' };
      console.log('PÓS-PAGAMENTO: e-mail já havia sido enviado. Não reenviando automaticamente.', eventoId);
    }else{
      email_resultado = await enviarEmailLiberacao(evEmail, evEmail.senha_transmissor, evEmail.sala_codigo);
      await registrarResultadoEmail(evEmail.id, email_resultado);
    }
  }catch(e){
    console.error('PÓS-PAGAMENTO: falha ao enviar e-mail automático:', e);
    email_resultado = { ok:false, error:String(e && e.message ? e.message : e) };
    await registrarResultadoEmail(up.id, email_resultado);
  }

  console.log('PÓS-PAGAMENTO: evento liberado automaticamente:', eventoId, up.sala_codigo);
  return { ok:true, evento:up, senha_transmissor:up.senha_transmissor, sala_codigo:up.sala_codigo, email_resultado };
}




async function confirmarPagamentoMercadoPago(eventoId, paymentId){
  if(!eventoId) return {ok:false, skipped:true, reason:'Sem evento_id.'};

  console.log('MERCADO PAGO: pagamento aprovado. Tentando confirmar apenas uma vez:', eventoId);

  const { data: pagamentoConfirmado, error: updateError } = await getSupabase().from('eventos').update({
   status_pagamento:'pago',
   pagamento_provedor:'mercadopago',
   pagamento_referencia:String(paymentId || ''),
   pagamento_confirmado_em:new Date().toISOString(),
   data_ultima_edicao:new Date().toISOString()
  }).eq('id', eventoId).is('pagamento_confirmado_em', null).select().maybeSingle();

  if(updateError){
   console.error('MERCADO PAGO: erro ao confirmar pagamento:', updateError);
   throw updateError;
  }

  if(!pagamentoConfirmado){
   console.log('MERCADO PAGO: pagamento já havia sido confirmado antes. Ignorando webhook repetido:', eventoId);
   return {ok:true, skipped:true, reason:'Pagamento já confirmado anteriormente.'};
  }

  await incrementarUsoCupomSeAplicavel(pagamentoConfirmado.cupom_codigo);
  const liberacao = await liberarAutomaticamenteAposPagamento(eventoId).catch(e => {
   console.error('MERCADO PAGO: erro na liberação automática pós-pagamento:', e);
   return {ok:false, error:String(e && e.message ? e.message : e)};
  });

  return {ok:true, evento_id:eventoId, liberacao_automatica:liberacao};
}

async function buscarPagamentoMercadoPago(paymentId){
  const response = await fetch(MERCADOPAGO_API_BASE + '/v1/payments/' + encodeURIComponent(paymentId), {
   headers:{'Authorization':'Bearer '+MERCADOPAGO_ACCESS_TOKEN}
  });

  const body = await response.json().catch(()=>({}));

  if(!response.ok){
   console.error('MERCADO PAGO: erro ao consultar pagamento:', body);
   throw new Error('Erro ao consultar pagamento Mercado Pago.');
  }

  return body;
}

async function buscarMerchantOrderMercadoPago(orderId){
  const response = await fetch(MERCADOPAGO_API_BASE + '/merchant_orders/' + encodeURIComponent(orderId), {
   headers:{'Authorization':'Bearer '+MERCADOPAGO_ACCESS_TOKEN}
  });

  const body = await response.json().catch(()=>({}));

  if(!response.ok){
   console.error('MERCADO PAGO: erro ao consultar order:', body);
   throw new Error('Erro ao consultar ordem Mercado Pago.');
  }

  return body;
}

app.get('/webhooks/mercadopago', async (req,res)=>{
 res.json({ok:true,service:'audesc-events-api',webhook:'mercadopago'});
});

app.post('/webhooks/mercadopago', async (req,res)=>{
 try{
  console.log('WEBHOOK MERCADO PAGO RECEBIDO:', new Date().toISOString());
  console.log('WEBHOOK MERCADO PAGO QUERY:', JSON.stringify(req.query || {}, null, 2));
  console.log('WEBHOOK MERCADO PAGO BODY:', JSON.stringify(req.body || {}, null, 2));

  if(!MERCADOPAGO_ACCESS_TOKEN){
   console.warn('MERCADO PAGO: MERCADOPAGO_ACCESS_TOKEN ausente.');
   return res.json({ok:true,received:true,ignored:true,reason:'Mercado Pago não configurado.'});
  }

  const body = req.body || {};
  const query = req.query || {};

  const tipo = body.type || body.topic || query.type || query.topic || '';
  const id = body?.data?.id || body.id || query['data.id'] || query.id || query.resource || null;

  if(!id){
   console.log('MERCADO PAGO: webhook sem id. Respondendo OK para simulação.');
   return res.json({ok:true,received:true,ignored:true,reason:'Webhook sem id.'});
  }

  if(tipo === 'payment' || String(id).startsWith('pay_') || (body.action && String(body.action).includes('payment'))){
   try{
    const pagamento = await buscarPagamentoMercadoPago(id);
    const status = pagamento.status;
    const eventoId = pagamento.external_reference || pagamento.metadata?.evento_id;

    console.log('MERCADO PAGO PAYMENT STATUS:', status);
    console.log('MERCADO PAGO EVENTO_ID:', eventoId);

    if(status === 'approved'){
     const resultado = await confirmarPagamentoMercadoPago(eventoId, pagamento.id);
     return res.json({ok:true,received:true,tipo:'payment',status,resultado});
    }

    return res.json({ok:true,received:true,tipo:'payment',status,approved:false});
   }catch(e){
    console.log('MERCADO PAGO: pagamento não consultável. Provável simulação do painel.');
    return res.json({ok:true,received:true,ignored:true,tipo:'payment',reason:'Pagamento não consultável ou simulação do painel.'});
   }
  }

  if(tipo === 'merchant_order' || tipo === 'order'){
   try{
    const order = await buscarMerchantOrderMercadoPago(id);
    const eventoId = order.external_reference || order.metadata?.evento_id;
    const pagamentos = Array.isArray(order.payments) ? order.payments : [];
    const aprovado = pagamentos.find(p => p.status === 'approved');

    console.log('MERCADO PAGO ORDER EVENTO_ID:', eventoId);
    console.log('MERCADO PAGO ORDER APROVADO:', !!aprovado);

    if(aprovado){
     const resultado = await confirmarPagamentoMercadoPago(eventoId, aprovado.id);
     return res.json({ok:true,received:true,tipo:'merchant_order',resultado});
    }

    return res.json({ok:true,received:true,tipo:'merchant_order',approved:false});
   }catch(e){
    console.log('MERCADO PAGO: ordem não consultável. Provável simulação do painel.');
    return res.json({
     ok:true,
     received:true,
     ignored:true,
     tipo:'merchant_order',
     reason:'Ordem não consultável ou simulação do painel.'
    });
   }
  }

  res.json({ok:true,received:true,ignored:true,tipo});

 }catch(e){
  console.error(e);
  res.json({ok:true,received:true,ignored:true,reason:e.message || 'Erro tratado no webhook Mercado Pago.'});
 }
});


app.post('/webhooks/paddle', async (req,res)=>{
 try{
  console.log('WEBHOOK PADDLE RECEBIDO:', new Date().toISOString());
  console.log('WEBHOOK PADDLE BODY:', JSON.stringify(req.body || {}, null, 2));
  const evento = req.body || {};
  const eventType = evento.event_type || evento.type || '';
  const data = evento.data || {};
  const custom = data.custom_data || {};
  const eventoId = custom.evento_id;

  console.log('WEBHOOK PADDLE EVENT_TYPE:', eventType);
  console.log('WEBHOOK PADDLE EVENTO_ID:', eventoId);
  console.log('WEBHOOK PADDLE STATUS:', data.status);

  if(!eventoId){
   console.log('WEBHOOK PADDLE IGNORADO: sem evento_id em custom_data.');
   return res.json({ok:true,ignored:true,reason:'Sem evento_id em custom_data.'});
  }

  const pago = ['transaction.completed','transaction.paid','transaction.payment_succeeded'].includes(eventType) || data.status === 'completed' || data.status === 'paid';

  let liberacao_automatica = null;

  if(pago){
   console.log('WEBHOOK PADDLE: pagamento reconhecido como PAGO. Tentando confirmar apenas uma vez:', eventoId);

   const { data: pagamentoConfirmado, error: updateError } = await getSupabase().from('eventos').update({
    status_pagamento:'pago',
    pagamento_provedor:'paddle',
    pagamento_referencia:data.id || null,
    pagamento_confirmado_em:new Date().toISOString(),
    data_ultima_edicao:new Date().toISOString()
   }).eq('id', eventoId).is('pagamento_confirmado_em', null).select().maybeSingle();

   if(updateError){
    console.error('WEBHOOK PADDLE: erro ao confirmar pagamento:', updateError);
    throw updateError;
   }

   if(!pagamentoConfirmado){
    console.log('WEBHOOK PADDLE: pagamento já havia sido confirmado antes. Ignorando webhook repetido:', eventoId);
    liberacao_automatica = { ok:true, skipped:true, reason:'Pagamento já confirmado anteriormente.' };
   }else{
    console.log('WEBHOOK PADDLE: pagamento confirmado pela primeira vez:', eventoId);

    await incrementarUsoCupomSeAplicavel(pagamentoConfirmado.cupom_codigo);
    liberacao_automatica = await liberarAutomaticamenteAposPagamento(eventoId).catch(e => {
     console.error('WEBHOOK PADDLE: erro na liberação automática pós-pagamento:', e);
     return { ok:false, error:String(e && e.message ? e.message : e) };
    });
   }
  } else {
   console.log('WEBHOOK PADDLE: recebido, mas não considerado pagamento concluído.');
  }

  res.json({ok:true,received:true,event_type:eventType,pago,liberacao_automatica});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message || 'Erro no webhook Paddle.'});
 }
});


app.delete('/meus-eventos/:id', async (req,res)=>{
 try{
  const user = await getUser(req);

  if(!user || !user.email){
   return res.status(401).json({
    error:'E-mail não autenticado. Acesse pelo link de validação.'
   });
  }

  const email = String(user.email || '')
   .trim()
   .toLowerCase();

  const sb = getSupabase();

  const {data:ev,error:findError} = await sb
   .from('eventos')
   .select('*')
   .eq('id', req.params.id)
   .eq('email_usuario', email)
   .single();

  if(findError) throw findError;

  if(!ev){
   return res.status(404).json({
    error:'Evento não encontrado para este e-mail.'
   });
  }

  if(ev.status_operacao === 'liberado'){
   return res.status(403).json({
    error:'Eventos liberados não podem ser excluídos definitivamente.'
   });
  }

  const {error:deleteError} = await sb
   .from('eventos')
   .delete()
   .eq('id', req.params.id)
   .eq('email_usuario', email);

  if(deleteError) throw deleteError;

  res.json({
   ok:true,
   mensagem:'Evento pendente excluído definitivamente.'
  });

 }catch(e){
  console.error(e);

  res.status(500).json({
   error:e.message || 'Erro ao excluir evento.'
  });
 }
});



app.patch('/meus-eventos/:id', async (req,res)=>{
 try{
  const user = await getUser(req);
  if(!user || !user.email) return res.status(401).json({error:'E-mail não autenticado. Acesse pelo link de validação.'});
  const email = String(user.email || '').trim().toLowerCase();
  const sb = getSupabase();
  const {data:ev,error:findError} = await sb.from('eventos').select('*').eq('id', req.params.id).eq('email_usuario', email).single();
  if(findError) throw findError;
  if(!ev) return res.status(404).json({error:'Evento não encontrado para este e-mail.'});
  if(ev.status_pagamento === 'pago' || ev.status_operacao === 'liberado'){
   return res.status(403).json({error:'Eventos pagos ou liberados não podem ser editados por esta página.'});
  }
  const allowed = ['titulo_original','descricao_original','categoria_evento','classificacao_etaria','modalidade_evento','abrangencia_divulgacao','paises_divulgacao','site_oficial','link_ingressos','link_inscricao','link_programacao','link_acessibilidade','data_evento','duracao_horas','max_ouvintes','tipo_evento','divulgar_acesso_ouvintes','tipo_servico','servicos_solicitados','pais','uf','origem_transmissao','pais_codigo','unidade_codigo','timezone','cidade','local_evento','local_nome','local_endereco','google_place_id','local_pais_codigo','local_unidade_codigo','latitude','longitude'];
  const update = {};
  for(const key of allowed){
   if(Object.prototype.hasOwnProperty.call(req.body || {}, key)) update[key] = req.body[key];
  }
  const paisCodigoEdicao = limit(update.pais_codigo || ev.pais_codigo || codigoPaisMaps(update.pais || ev.pais),10);
  const unidadeCodigoEdicao = limit(update.unidade_codigo || ev.unidade_codigo || codigoUnidadeLocal(paisCodigoEdicao, update.uf || ev.uf, ''),20);
  const formularioCfgEdicao = await obterFormularioConfig();
  const localCfgEdicao = resolverFormularioConfigParaLocal(formularioCfgEdicao, paisCodigoEdicao, unidadeCodigoEdicao);
  if(Object.prototype.hasOwnProperty.call(update,'titulo_original')){
   update.titulo_original = validarTextoConfigurado(update.titulo_original, 'o nome do evento', localCfgEdicao.limites?.titulo_original, true);
  }
  if(Object.prototype.hasOwnProperty.call(update,'categoria_evento')){
   const categoriaCfgEdicao=localCfgEdicao.campos?.categoria_evento || {visivel:true,obrigatorio:true};
   if(categoriaCfgEdicao.visivel === false){ delete update.categoria_evento; }
   else {
    const categoria=normalizarCategoriaEvento(update.categoria_evento);
    if(categoriaCfgEdicao.obrigatorio && !categoria) return res.status(400).json({error:'Selecione a categoria do evento.'});
    if(update.categoria_evento && !categoria) return res.status(400).json({error:'Categoria do evento inválida.'});
    update.categoria_evento=categoria;
   }
  }
  if(Object.prototype.hasOwnProperty.call(update,'classificacao_etaria')){
   const classificacaoCfgEdicao=localCfgEdicao.campos?.classificacao_etaria || {visivel:true,obrigatorio:false};
   if(classificacaoCfgEdicao.visivel === false){ delete update.classificacao_etaria; }
   else {
    const classificacao=normalizarClassificacaoEtaria(update.classificacao_etaria);
    if(classificacaoCfgEdicao.obrigatorio && !classificacao) return res.status(400).json({error:'Selecione a classificação etária.'});
    if(update.classificacao_etaria && !classificacao) return res.status(400).json({error:'Classificação etária inválida.'});
    update.classificacao_etaria=classificacao;
   }
  }
  if(Object.prototype.hasOwnProperty.call(update,'modalidade_evento')) update.modalidade_evento=normalizarModalidadeEvento(update.modalidade_evento);
  const modalidadeFinal=update.modalidade_evento||ev.modalidade_evento||'presencial';
  if(Object.prototype.hasOwnProperty.call(update,'abrangencia_divulgacao')) update.abrangencia_divulgacao=normalizarAbrangenciaDivulgacao(update.abrangencia_divulgacao,modalidadeFinal);
  if(Object.prototype.hasOwnProperty.call(update,'paises_divulgacao')) update.paises_divulgacao=normalizarPaisesDivulgacao(update.paises_divulgacao);
  const abrangenciaFinal=Object.prototype.hasOwnProperty.call(update,'abrangencia_divulgacao')?update.abrangencia_divulgacao:ev.abrangencia_divulgacao;
  const paisesFinal=Object.prototype.hasOwnProperty.call(update,'paises_divulgacao')?update.paises_divulgacao:(ev.paises_divulgacao||[]);
  if(modalidadeFinal!=='presencial'&&!abrangenciaFinal) return res.status(400).json({error:'Selecione a abrangência da divulgação.'});
  if(abrangenciaFinal==='internacional'&&!paisesFinal.length) return res.status(400).json({error:'Selecione pelo menos um país para a divulgação internacional.'});
  if(abrangenciaFinal!=='internacional') update.paises_divulgacao=[];
  if(Object.prototype.hasOwnProperty.call(update,'descricao_original')){
   const descricaoObrigatoriaEdicao = !!localCfgEdicao.campos?.descricao_original?.obrigatorio;
   update.descricao_original = validarTextoConfigurado(update.descricao_original, 'a descrição do evento', localCfgEdicao.limites?.descricao_original, descricaoObrigatoriaEdicao);
  }
  ['site_oficial','link_ingressos','link_inscricao','link_programacao','link_acessibilidade'].forEach(k=>{ if(Object.prototype.hasOwnProperty.call(update,k)) update[k]=safeUrl(update[k]); });
  if(Object.prototype.hasOwnProperty.call(update,'duracao_horas')) update.duracao_horas = Math.max(1,Math.min(8,Number(update.duracao_horas||1)));
  if(Object.prototype.hasOwnProperty.call(update,'max_ouvintes')){
   const n=Math.max(10,Math.min(500,Number(update.max_ouvintes||10)));
   update.max_ouvintes=Math.ceil(n/10)*10;
  }
  if(Object.prototype.hasOwnProperty.call(update,'tipo_evento')) update.tipo_evento = text(update.tipo_evento)==='publico'?'publico':'privado';
  if(Object.prototype.hasOwnProperty.call(update,'divulgar_acesso_ouvintes')) update.divulgar_acesso_ouvintes = (update.tipo_evento || ev.tipo_evento) === 'publico' && (update.divulgar_acesso_ouvintes === true || text(update.divulgar_acesso_ouvintes) === 'true');
  if(Object.prototype.hasOwnProperty.call(update,'servicos_solicitados')){
   const selecionados=normalizarServicosSolicitados(update.servicos_solicitados, update.tipo_servico || ev.tipo_servico);
   if(!selecionados.length) return res.status(400).json({error:'Selecione pelo menos um serviço.'});
   if(selecionados.includes('audesc_transmissao') && selecionados.includes('divulgacao_gratuita')) return res.status(400).json({error:'Transmissão Audesc e Somente divulgação no Audesc não podem ser selecionados simultaneamente.'});
   update.servicos_solicitados=selecionados;
   update.tipo_servico=tipoServicoLegado(selecionados);
   update.status_agenda=selecionados.some(servicoRequerAgenda)?'pendente':'nao_aplicavel';
   if(!selecionados.includes('audesc_transmissao')) update.max_ouvintes=null;
   if(!selecionados.includes('audesc_transmissao') && !selecionados.some(servicoRequerAgenda)) update.duracao_horas=null;
   if(selecionados.includes('divulgacao_gratuita')){update.tipo_evento='publico'; update.divulgar_acesso_ouvintes=false;}
  }
  if(Object.prototype.hasOwnProperty.call(update,'tipo_servico') && !Object.prototype.hasOwnProperty.call(update,'servicos_solicitados')){
   const tiposServicoValidos=listarTiposServicoValidos();
   const tipoSolicitado=text(update.tipo_servico);
   update.tipo_servico = tiposServicoValidos.includes(tipoSolicitado) ? tipoSolicitado : (ev.tipo_servico || 'audesc_transmissao');
   const evAtualizadoParaCalculo = {...ev, ...update};
   update.status_pagamento = await statusPagamentoInicial(evAtualizadoParaCalculo);
   update.status_agenda = SERVICOS_COM_AGENDA.includes(update.tipo_servico) ? 'pendente' : 'nao_aplicavel';
   update.status_operacao = 'nao_liberado';
  }
  if(Object.prototype.hasOwnProperty.call(update,'local_evento')) update.local_evento = limit(update.local_evento,500);
    if(Object.prototype.hasOwnProperty.call(update,'local_nome')) update.local_nome = limit(update.local_nome,200);
    if(Object.prototype.hasOwnProperty.call(update,'local_endereco')) update.local_endereco = limit(update.local_endereco,400);
    if(Object.prototype.hasOwnProperty.call(update,'google_place_id')) update.google_place_id = limit(update.google_place_id,255);
    if(Object.prototype.hasOwnProperty.call(update,'local_pais_codigo')) update.local_pais_codigo = limit(update.local_pais_codigo,10);
    if(Object.prototype.hasOwnProperty.call(update,'local_unidade_codigo')) update.local_unidade_codigo = limit(update.local_unidade_codigo,30);
  if(Object.prototype.hasOwnProperty.call(update,'latitude')) update.latitude = numeroCoordenada(update.latitude);
  if(Object.prototype.hasOwnProperty.call(update,'longitude')) update.longitude = numeroCoordenada(update.longitude);
  if(Object.prototype.hasOwnProperty.call(update,'pais')) update.pais = text(update.pais);
  const paisFinalEdicao = Object.prototype.hasOwnProperty.call(update,'pais') ? update.pais : ev.pais;
  if(Object.prototype.hasOwnProperty.call(update,'uf')) update.uf = (paisFinalEdicao === 'Outros' || paisFinalEdicao === 'Internacional') ? '' : text(update.uf);
  if(Object.prototype.hasOwnProperty.call(update,'origem_transmissao')) update.origem_transmissao = paisFinalEdicao === 'Internacional' ? text(update.origem_transmissao) : '';
  else if(Object.prototype.hasOwnProperty.call(update,'pais') && paisFinalEdicao !== 'Internacional') update.origem_transmissao = '';
  if(Object.prototype.hasOwnProperty.call(update,'pais_codigo')) update.pais_codigo = limit(update.pais_codigo || codigoPaisMaps(paisFinalEdicao === 'Internacional' ? update.origem_transmissao : update.pais),10);
  if(Object.prototype.hasOwnProperty.call(update,'unidade_codigo')) update.unidade_codigo = limit(update.unidade_codigo,20);
  const paisParaTimezoneUsuario = paisFinalEdicao === 'Internacional' ? update.origem_transmissao || ev.origem_transmissao : paisFinalEdicao;
  if(Object.prototype.hasOwnProperty.call(update,'pais') || Object.prototype.hasOwnProperty.call(update,'uf') || Object.prototype.hasOwnProperty.call(update,'origem_transmissao') || Object.prototype.hasOwnProperty.call(update,'pais_codigo') || Object.prototype.hasOwnProperty.call(update,'unidade_codigo') || Object.prototype.hasOwnProperty.call(update,'timezone')) update.timezone = timezonePorLocal(update.pais_codigo || paisCodigoEdicao, update.unidade_codigo || unidadeCodigoEdicao, paisParaTimezoneUsuario);
  if(Object.prototype.hasOwnProperty.call(update,'data_evento')) update.data_evento = prepararDataEvento(update.data_evento, update.timezone || ev.timezone);
  if(Object.prototype.hasOwnProperty.call(update,'cidade')) update.cidade = limit(update.cidade,120);
  const servicosFinais = normalizarServicosSolicitados(update.servicos_solicitados, update.tipo_servico || ev.tipo_servico);
  const paisCodigoFinal = update.pais_codigo || paisCodigoEdicao;
  const unidadeCodigoFinal = update.unidade_codigo || unidadeCodigoEdicao;
  const localCfgFinal = resolverFormularioConfigParaLocal(formularioCfgEdicao, paisCodigoFinal, unidadeCodigoFinal);
  const houveMudancaDeServicoOuLocal = Object.prototype.hasOwnProperty.call(update,'tipo_servico') ||
   Object.prototype.hasOwnProperty.call(update,'servicos_solicitados') ||
   Object.prototype.hasOwnProperty.call(update,'pais') ||
   Object.prototype.hasOwnProperty.call(update,'uf') ||
   Object.prototype.hasOwnProperty.call(update,'pais_codigo') ||
   Object.prototype.hasOwnProperty.call(update,'unidade_codigo');
  if(houveMudancaDeServicoOuLocal && Array.isArray(localCfgFinal.servicosDisponiveis)){
   const indisponiveis=servicosFinais.filter(c=>!localCfgFinal.servicosDisponiveis.includes(c));
   if(indisponiveis.length) return res.status(400).json({error:'Um ou mais serviços selecionados não estão disponíveis para o país e a unidade administrativa selecionados.'});
  }
  update.titulo_publicado = update.titulo_original || ev.titulo_publicado || ev.titulo_original;
  update.descricao_publicada = Object.prototype.hasOwnProperty.call(update,'descricao_original') ? update.descricao_original : (ev.descricao_publicada || ev.descricao_original);
  update.data_ultima_edicao = new Date().toISOString();
  if(ev.tipo_evento === 'publico' || update.tipo_evento === 'publico'){
   update.status_publicacao = await emailConfiavel(email) ? 'aprovado' : 'pendente';
  }
  const {data,error}=await sb.from('eventos').update(update).eq('id', req.params.id).eq('email_usuario', email).select().single();
  if(error) throw error;
  res.json({ok:true,evento:data,mensagem:'Evento atualizado.'});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message || 'Erro ao atualizar evento.'});
 }
});


app.get('/meus-eventos/:id', async (req,res)=>{
 try{
  const user = await getUser(req);
  if(!user || !user.email) return res.status(401).json({error:'E-mail não autenticado. Acesse pelo link de validação.'});
  const email = String(user.email || '').trim().toLowerCase();
  const {data,error} = await getSupabase().from('eventos').select('*').eq('id', req.params.id).eq('email_usuario', email).single();
  if(error) throw error;
  if(!data) return res.status(404).json({error:'Evento não encontrado para este e-mail.'});
  const evento = await sincronizarStatusPagamentoDivulgacao(data);
  res.json({ok:true,email,evento});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message || 'Erro ao carregar evento.'});
 }
});

app.listen(PORT,()=>console.log(`Audesc Events API rodando na porta ${PORT}`));
