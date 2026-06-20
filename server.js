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
function carregarServicosConfig(){
  const padrao = [
    {codigo:'audesc_transmissao',nome:'Transmissão Audesc (transmissor e receptores)',ativo:true,requerAgenda:false,usaTransmissao:true,somenteDivulgacao:false,somenteProfissional:false,permiteValorManual:false},
    {codigo:'divulgacao_gratuita',nome:'Somente divulgação no Audesc',ativo:true,requerAgenda:false,usaTransmissao:false,somenteDivulgacao:true,somenteProfissional:false,permiteValorManual:false},
    {codigo:'audesc_com_audiodescritor',nome:'Serviço completo - Audesc + audiodescritor',ativo:true,requerAgenda:true,usaTransmissao:true,somenteDivulgacao:false,somenteProfissional:false,permiteValorManual:true},
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
      },
      regrasPorServico: {
        divulgacao_gratuita: {
          campos: {
            tipo_evento: { comportamento: 'fixo', valor: 'publico' },
            divulgar_acesso_ouvintes: { comportamento: 'oculto_sem_valor' },
            duracao_horas: { comportamento: 'oculto_sem_valor' },
            max_ouvintes: { comportamento: 'oculto_sem_valor' }
          }
        },
        somente_audiodescritor: {
          campos: {
            divulgar_acesso_ouvintes: { comportamento: 'oculto_sem_valor' },
            max_ouvintes: { comportamento: 'oculto_sem_valor' }
          }
        },
        somente_consultor: {
          campos: {
            divulgar_acesso_ouvintes: { comportamento: 'oculto_sem_valor' },
            max_ouvintes: { comportamento: 'oculto_sem_valor' }
          }
        }
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
      const campos = {};
      for(const campo of Object.keys(base.padrao.campos)){
        if(!Object.prototype.hasOwnProperty.call(camposFonte, campo)) continue;
        const c = camposFonte[campo] && typeof camposFonte[campo] === 'object' ? camposFonte[campo] : {};
        const comportamento = comportamentos.has(c.comportamento || c.modo) ? (c.comportamento || c.modo) : 'usuario';
        let valor = c.valor;
        if(campo === 'tipo_evento' && valor !== 'privado') valor = 'publico';
        if(campo === 'divulgar_acesso_ouvintes') valor = valor === true || String(valor).trim() === 'true';
        campos[campo] = { comportamento, valor: valor ?? '' };
      }
      out[codigo] = { campos };
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
    padrao: { servicosDisponiveis: limpaServicos(cfg.padrao?.servicosDisponiveis, base.padrao.servicosDisponiveis), campos, limites, regrasPorServico: regrasPorServicoPadrao },
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
function regraCampoPorServico(localCfg, tipoServico, campo){
  const servico = localCfg?.regrasPorServico?.[tipoServico] || {};
  return servico?.campos?.[campo] || null;
}
function valorConfiguradoPorServico(localCfg, tipoServico, campo, valorOriginal){
  const regra = regraCampoPorServico(localCfg, tipoServico, campo);
  const comportamento = regra?.comportamento || regra?.modo || '';
  if(comportamento === 'fixo') return regra.valor;
  if(comportamento === 'oculto_sem_valor') return null;
  return valorOriginal;
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
async function getSheets(){ if(!GOOGLE_SHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) throw new Error('Google Sheets não configurado.'); const auth=new google.auth.JWT({email:GOOGLE_CLIENT_EMAIL,key:GOOGLE_PRIVATE_KEY,scopes:['https://www.googleapis.com/auth/spreadsheets']}); return google.sheets({version:'v4',auth}); }
function endDate(start,hours){ const d=start?new Date(start):new Date(); return new Date(d.getTime()+Number(hours||2)*3600000).toISOString(); }
async function appendSheet(ev,senha,sala){ const sheets=await getSheets(); const title=ev.titulo_publicado||ev.titulo_original||'Evento Audesc'; const start=ev.data_evento||new Date().toISOString(); const row=[senha,sala,title,ev.max_ouvintes||20,ev.duracao_horas||2,start,endDate(start,ev.duracao_horas),'ativo','sim',10,'','','','']; await sheets.spreadsheets.values.append({spreadsheetId:GOOGLE_SHEET_ID,range:`${SHEET_NAME}!A:N`,valueInputOption:'USER_ENTERED',insertDataOption:'INSERT_ROWS',requestBody:{values:[row]}}); }


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
async function obterPrecoServico(tipoServico, moeda){
 const servico=text(tipoServico)||'audesc_transmissao';
 try{
  const {data,error}=await getSupabase().from('precificacao_servicos').select('*').eq('tipo_servico',servico).eq('moeda',moeda).maybeSingle();
  if(error) throw error;
  return data||null;
 }catch(e){console.warn('Preço de serviço indisponível:',e.message||e);return null;}
}
async function calcularValorBaseServico(ev, moeda){
 const tipo=text(ev.tipo_servico)||'audesc_transmissao';
 const duracao=Math.max(1,Number(ev.duracao_horas||1));
 const ouvintes=Math.max(10,Number(ev.max_ouvintes||10));
 if(servicoSomenteDivulgacao(tipo)){
  const preco=await obterPrecoServico(tipo,moeda);
  const valorServico=preco?numeroSeguro(preco.valor_hora,preco.valor_base_10_ouvintes_1_hora):0;
  return {valor_original:arredondarValor(valorServico),ouvintes:null,duracao_horas:1,tipo_servico:tipo,detalhes:{descricao:nomeServico(tipo),valor_servico:valorServico}};
 }
 if(servicoSomenteProfissional(tipo)){
  const preco=await obterPrecoServico(tipo,moeda);
  const valorHora=preco?numeroSeguro(preco.valor_hora,preco.valor_base_10_ouvintes_1_hora):0;
  return {valor_original:arredondarValor(valorHora*duracao),ouvintes:null,duracao_horas:duracao,tipo_servico:tipo,detalhes:{descricao:nomeServico(tipo),valor_hora:valorHora}};
 }
 if(tipo==='audesc_com_audiodescritor'){
  const pAud=await obterPrecificacao(moeda,'audesc_transmissao');
  const pacoteAud=calcularValorPacote(ev,pAud);
  const pAd=await obterPrecoServico('somente_audiodescritor',moeda);
  const valorHoraAd=pAd?numeroSeguro(pAd.valor_hora,pAd.valor_base_10_ouvintes_1_hora):0;
  const valorAd=arredondarValor(valorHoraAd*duracao);
  return {valor_original:arredondarValor(pacoteAud.valor_original+valorAd),ouvintes:pacoteAud.ouvintes,duracao_horas:pacoteAud.duracao_horas,tipo_servico:tipo,detalhes:{descricao:nomeServico(tipo),valor_audesc:pacoteAud.valor_original,valor_audiodescritor:valorAd,valor_hora_audiodescritor:valorHoraAd}};
 }
 return null;
}


function valorNumericoOuNull(v){
  if(v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? arredondarValor(n) : null;
}

async function calcularValorSugeridoAgenda(ev){
  const moeda = moedaDoEvento(ev);
  const pacote = await calcularValorBaseServico(ev, moeda);
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
  const moeda = moedaDoEvento(ev);
  const servicoCalculado = await calcularValorBaseServico(ev, moeda);
  let pacote = null;
  if(servicoCalculado){
    pacote = servicoCalculado;
  }else{
    const precificacao = await obterPrecificacao(moeda, ev.tipo_servico);
    pacote = calcularValorPacote(ev, precificacao);
  }
  pacote = aplicarValorFinalAgendaSeExistir(ev, pacote);

  let cupom = null;
  let desconto = 0;
  const codigo = text(codigoCupom).toUpperCase();

  if(codigo){
    const { data: cupomData, error: cupomError } = await getSupabase()
      .from('cupons')
      .select('*')
      .eq('codigo', codigo)
      .maybeSingle();

    if(cupomError) throw cupomError;
    if(!cupomData) throw new Error('Cupom não encontrado.');
    if(!cupomData.ativo) throw new Error('Cupom inativo.');
    if(cupomData.validade && new Date(cupomData.validade).getTime() < Date.now()) throw new Error('Cupom expirado.');
    if(cupomData.limite_uso != null && Number(cupomData.usos_realizados || 0) >= Number(cupomData.limite_uso)) throw new Error('Cupom esgotado.');
    if(cupomData.moeda && cupomData.moeda !== moeda) throw new Error('Este cupom não é válido para a moeda deste pagamento.');

    if(cupomData.tipo_desconto === 'percentual'){
      desconto = pacote.valor_original * (Number(cupomData.valor_desconto || 0) / 100);
    }else{
      desconto = Number(cupomData.valor_desconto || 0);
    }

    desconto = Math.min(pacote.valor_original, arredondarValor(desconto));
    cupom = cupomData;
  }

  const valorFinal = arredondarValor(pacote.valor_original - desconto);

  return {
    moeda,
    pacote,
    cupom,
    cupom_codigo: cupom ? cupom.codigo : null,
    desconto_aplicado: desconto,
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
    let resultado=await geocodeNominatim(query,ctx);
    if(!resultado) resultado=await geocodeGoogle(query,ctx);
    if(!resultado){
      return res.status(404).json({error:'Local não encontrado na região selecionada. Tente informar também bairro, cidade ou endereço completo.'});
    }
    return res.json({ok:true,resultado});
  }catch(e){
    console.error('Erro no geocode:', e);
    return res.status(500).json({error:'Erro ao buscar coordenadas do local.'});
  }
});

app.get('/health',(req,res)=>res.json({ok:true,service:'audesc-events-api',version:'v41-servicos-centralizados' }));


const SERVICOS_COM_AGENDA = SERVICOS_CONFIG.filter(s => s.ativo !== false && s.requerAgenda).map(s => s.codigo);
function requerAgendaProfissional(ev){
  return servicoRequerAgenda(String(ev?.tipo_servico || '').trim());
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
  if(servicoSomenteDivulgacao(String(ev?.tipo_servico || '').trim())){
    const dados = await calcularPagamentoEvento(ev, '');
    return dados.valor_final > 0 ? 'pendente' : 'dispensado';
  }
  return 'pendente';
}

async function sincronizarStatusPagamentoDivulgacao(ev){
  if(!ev || !servicoSomenteDivulgacao(String(ev.tipo_servico || '').trim())) return ev;
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
  const tipoSolicitado=text(b.tipo_servico);
  const tipo_servico=tiposServicoValidos.includes(tipoSolicitado)?tipoSolicitado:'audesc_transmissao';
  let tipo_evento=text(b.tipo_evento)==='publico'?'publico':'privado';
  let divulgar_acesso_ouvintes = tipo_evento === 'publico' && (b.divulgar_acesso_ouvintes === true || text(b.divulgar_acesso_ouvintes) === 'true');
  let duracao_horas=Math.max(1,Math.min(8,Number(b.duracao_horas||2)));
  let max_ouvintes=Math.max(10,Math.min(500,Number(b.max_ouvintes||20)));
  const paisEvento = text(b.pais)==='Outros' ? text(b.pais_outro) : text(b.pais);
  const ufEvento = (text(b.pais)==='Outros' || text(b.pais)==='Internacional') ? '' : text(b.uf);
  const paisCodigoEvento = limit(b.pais_codigo || b.paisCodigo || codigoPaisMaps(paisEvento),10);
  const unidadeCodigoEvento = limit(b.unidade_codigo || b.unidadeCodigo || codigoUnidadeLocal(paisCodigoEvento, ufEvento, b.ufTexto),20);
  const formularioCfg = await obterFormularioConfig();
  const localCfg = resolverFormularioConfigParaLocal(formularioCfg, paisCodigoEvento, unidadeCodigoEvento);
  if(Array.isArray(localCfg.servicosDisponiveis) && !localCfg.servicosDisponiveis.includes(tipo_servico)){
    return res.status(400).json({error:'Este tipo de solicitação não está disponível para o país e a unidade administrativa selecionados.'});
  }
  // Aplica regras configuráveis por serviço antes de gravar o evento.
  const tipoEventoConfigurado = valorConfiguradoPorServico(localCfg, tipo_servico, 'tipo_evento', tipo_evento);
  tipo_evento = text(tipoEventoConfigurado) === 'publico' ? 'publico' : 'privado';
  const acessoConfigurado = valorConfiguradoPorServico(localCfg, tipo_servico, 'divulgar_acesso_ouvintes', divulgar_acesso_ouvintes);
  divulgar_acesso_ouvintes = tipo_evento === 'publico' && (acessoConfigurado === true || text(acessoConfigurado) === 'true');
  const duracaoConfigurada = valorConfiguradoPorServico(localCfg, tipo_servico, 'duracao_horas', duracao_horas);
  const ouvintesConfigurado = valorConfiguradoPorServico(localCfg, tipo_servico, 'max_ouvintes', max_ouvintes);
  duracao_horas = duracaoConfigurada === null ? null : Math.max(1, Math.min(8, Number(duracaoConfigurada || 2)));
  max_ouvintes = ouvintesConfigurado === null ? null : Math.max(10, Math.min(500, Number(ouvintesConfigurado || 20)));
  const camposCfg = localCfg.campos || {};
  const titulo = validarTextoConfigurado(b.titulo_original, 'o nome do evento', localCfg.limites?.titulo_original, true);
  const descricaoObrigatoria = !!camposCfg.descricao_original?.obrigatorio;
  const descricaoOriginal = validarTextoConfigurado(b.descricao_original, 'a descrição do evento', localCfg.limites?.descricao_original, descricaoObrigatoria);
  const ev={user_id:user.id,email_usuario:user.email,tipo_servico,tipo_evento,divulgar_acesso_ouvintes,status_publicacao:(tipo_evento==='publico'&&!usuarioConfiavel)?'pendente':'aprovado',status_pagamento:'pendente',status_agenda:SERVICOS_COM_AGENDA.includes(tipo_servico)?'pendente':'nao_aplicavel',status_operacao:'nao_liberado',titulo_original:titulo,descricao_original:descricaoOriginal,site_oficial:safeUrl(b.site_oficial),link_ingressos:safeUrl(b.link_ingressos),link_inscricao:safeUrl(b.link_inscricao),link_programacao:safeUrl(b.link_programacao),link_acessibilidade:safeUrl(b.link_acessibilidade),local_evento:limit(b.local_evento,300),latitude:numeroCoordenada(b.latitude),longitude:numeroCoordenada(b.longitude),pais_codigo:paisCodigoEvento,unidade_codigo:unidadeCodigoEvento,cidade:limit(b.cidade,120),pais: paisEvento,
      uf: ufEvento,
      origem_transmissao: text(b.pais)==='Internacional' ? text(b.origem_transmissao) : '',
      data_evento:b.data_evento||null,duracao_horas,max_ouvintes};
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
    if(!data || data.length === 0) return senha;
  }
  throw new Error('Não foi possível gerar senha única.');
}

async function gerarSalaUnica(sb){
  for(let i=0;i<30;i++){
    const sala = makeRoom();
    const { data, error } = await sb.from('eventos').select('id').eq('sala_codigo', sala).limit(1);
    if(error) throw error;
    if(!data || data.length === 0) return sala;
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

function inscritoCompatívelComEvento(inscrito, ev){
  if(!inscrito || !inscrito.email || inscrito.ativo !== true || inscrito.email_validado !== true) return false;
  if(inscrito.receber_todos === true) return true;
  const paisEvento = text(ev.pais_codigo || codigoPaisMaps(ev.pais)).toUpperCase();
  const paisInscrito = text(inscrito.pais_codigo || codigoPaisMaps(inscrito.pais)).toUpperCase();
  if(paisEvento && paisInscrito && paisEvento !== paisInscrito) return false;
  const unidadeEvento = text(ev.unidade_codigo || codigoUnidadeLocal(paisEvento, ev.uf, ev.uf)).toUpperCase();
  const unidadeInscrito = text(inscrito.unidade_codigo || codigoUnidadeLocal(paisInscrito, inscrito.uf, inscrito.uf)).toUpperCase();
  if(unidadeEvento && unidadeInscrito && unidadeInscrito !== 'NACIONAL' && unidadeEvento !== unidadeInscrito) return false;
  if(Array.isArray(inscrito.eventos_ids) && inscrito.eventos_ids.length){
    return inscrito.eventos_ids.includes(ev.id);
  }
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
  if((servicoUsaTransmissao(evSincronizado.tipo_servico) || servicoSomenteDivulgacao(evSincronizado.tipo_servico)) && evSincronizado.status_pagamento!=='pago' && evSincronizado.status_pagamento!=='dispensado') return res.status(400).json({error:'Evento ainda não consta como pago.'});
  if(servicoSomenteDivulgacao(evSincronizado.tipo_servico)){
   const {data:up,error:er}=await sb.from('eventos').update({status_operacao:'liberado',data_ultima_edicao:new Date().toISOString()}).eq('id',req.params.id).select().single();
   if(er) throw er; return res.json({ok:true,tipo:'divulgacao_gratuita',evento:up});
  }
  const senha=ev.senha_transmissor||await gerarSenhaUnica(sb); const sala=ev.sala_codigo||await gerarSalaUnica(sb);
  const enviarEmailLiberacaoAdmin = !(
    req.query?.enviar_email === 'false' ||
    req.query?.sem_email === 'true' ||
    req.body?.enviar_email === false ||
    req.body?.sem_email === true
  );
  await appendSheet(ev,senha,sala);
  const {data:up,error:er}=await sb.from('eventos').update({senha_transmissor:senha,sala_codigo:sala,status_operacao:'liberado',data_ultima_edicao:new Date().toISOString()}).eq('id',req.params.id).select().single();
  if(er) throw er;
  let email_resultado = { ok:false, skipped:true, reason:'Envio automático desmarcado pelo administrador.' };
  if(enviarEmailLiberacaoAdmin){
    email_resultado = await enviarEmailLiberacao(up, senha, sala).catch(err => {
      console.error('Falha inesperada ao enviar e-mail de liberação:', err);
      return { ok:false, error:String(err && err.message ? err.message : err) };
    });
  }
  await registrarResultadoEmail(up.id, email_resultado);
  res.json({ok:true,tipo:'audesc_transmissao',senha_transmissor:senha,sala_codigo:sala,email_resultado,evento:up});
 }catch(e){ console.error(e); res.status(500).json({error:e.message||'Erro ao liberar evento.'}); }
}
app.post('/liberar-evento/:id',liberar);
app.get('/liberar-evento/:id',liberar);




app.get('/formulario-config', async (req,res)=>{
  try{
    const cfg = await obterFormularioConfig();
    res.json({ok:true,config:cfg,servicos:SERVICOS_CONFIG});
  }catch(e){
    res.status(500).json({error:e.message || 'Erro ao carregar configuração do formulário.'});
  }
});

app.get('/admin/formulario-config', async (req,res)=>{
  try{
    if(!admin(req,res)) return;
    const cfg = await obterFormularioConfig();
    res.json({ok:true,config:cfg,servicos:SERVICOS_CONFIG});
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

app.get('/admin/precificacao', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const {data,error}=await getSupabase().from('precificacao').select('*').order('moeda',{ascending:true});
  if(error) throw error;
  res.json({ok:true,precificacao:data||[]});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message||'Erro ao carregar precificação.'});
 }
});

app.patch('/admin/precificacao/:moeda', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const moeda = String(req.params.moeda || '').toUpperCase();
  if(!['BRL','USD','EUR'].includes(moeda)) return res.status(400).json({error:'Moeda inválida.'});

  const b=req.body||{};
  const update={
   valor_base_10_ouvintes_1_hora:Number(b.valor_base_10_ouvintes_1_hora),
   acrescimo_por_10_ouvintes:Number(b.acrescimo_por_10_ouvintes),
   ouvintes_minimos:Number(b.ouvintes_minimos||10),
   duracao_minima_horas:Number(b.duracao_minima_horas||1),
   atualizado_em:new Date().toISOString()
  };

  const {data,error}=await getSupabase().from('precificacao').update(update).eq('moeda',moeda).select().single();
  if(error) throw error;
  res.json({ok:true,precificacao:data});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message||'Erro ao atualizar precificação.'});
 }
});

app.get('/admin/cupons', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const {data,error}=await getSupabase().from('cupons').select('*').order('criado_em',{ascending:false});
  if(error) throw error;
  res.json({ok:true,cupons:data||[]});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message||'Erro ao carregar cupons.'});
 }
});

app.post('/admin/cupons', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const b=req.body||{};
  const codigo=text(b.codigo).toUpperCase();
  if(!codigo) return res.status(400).json({error:'Informe o código do cupom.'});
  const tipo=text(b.tipo_desconto);
  if(!['percentual','valor_fixo'].includes(tipo)) return res.status(400).json({error:'Tipo de desconto inválido.'});

  const payload={
   codigo,
   tipo_desconto:tipo,
   valor_desconto:Number(b.valor_desconto||0),
   moeda:text(b.moeda)||null,
   ativo:b.ativo !== false,
   validade:b.validade || null,
   limite_uso:b.limite_uso === '' || b.limite_uso == null ? null : Number(b.limite_uso),
   atualizado_em:new Date().toISOString()
  };

  const {data,error}=await getSupabase().from('cupons').insert(payload).select().single();
  if(error) throw error;
  res.json({ok:true,cupom:data});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message||'Erro ao criar cupom.'});
 }
});

app.patch('/admin/cupons/:id', async (req,res)=>{
 try{
  if(!admin(req,res)) return;
  const b=req.body||{};
  const update={atualizado_em:new Date().toISOString()};

  ['codigo','tipo_desconto','moeda'].forEach(k=>{
   if(Object.prototype.hasOwnProperty.call(b,k)) update[k]=k==='codigo'?text(b[k]).toUpperCase():(text(b[k])||null);
  });
  ['valor_desconto','limite_uso'].forEach(k=>{
   if(Object.prototype.hasOwnProperty.call(b,k)) update[k]=(b[k]===''||b[k]==null)?null:Number(b[k]);
  });
  ['ativo'].forEach(k=>{
   if(Object.prototype.hasOwnProperty.call(b,k)) update[k]=!!b[k];
  });
  if(Object.prototype.hasOwnProperty.call(b,'validade')) update.validade=b.validade||null;

  const {data,error}=await getSupabase().from('cupons').update(update).eq('id',req.params.id).select().single();
  if(error) throw error;
  res.json({ok:true,cupom:data});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message||'Erro ao atualizar cupom.'});
 }
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
   .select('id,titulo_original,titulo_publicado,email_usuario,tipo_servico,pais,uf,pais_codigo,unidade_codigo,cidade,origem_transmissao,local_evento,latitude,longitude,data_evento,status_agenda,observacao_agenda,valor_sugerido_agenda,valor_final_agenda,valor_agenda_definido_por_admin,status_pagamento,status_publicacao,status_operacao,created_at')
   .in('tipo_servico', SERVICOS_COM_AGENDA)
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
      'site_oficial',
      'link_ingressos',
      'link_inscricao',
      'link_programacao',
      'link_acessibilidade',
      'data_evento',
      'duracao_horas',
      'max_ouvintes',
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
      'local_evento',
      'latitude',
      'longitude',
      'pais_codigo',
      'unidade_codigo',
      'cidade'
    ];
    const update = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
        update[key] = req.body[key];
      }
    }
    ['site_oficial','link_ingressos','link_inscricao','link_programacao','link_acessibilidade'].forEach(k=>{ if(Object.prototype.hasOwnProperty.call(update,k)) update[k]=safeUrl(update[k]); });
    if(Object.prototype.hasOwnProperty.call(update,'tipo_evento')) update.tipo_evento = text(update.tipo_evento)==='publico'?'publico':'privado';
    if(Object.prototype.hasOwnProperty.call(update,'divulgar_acesso_ouvintes')) update.divulgar_acesso_ouvintes = update.tipo_evento === 'publico' && (update.divulgar_acesso_ouvintes === true || text(update.divulgar_acesso_ouvintes) === 'true');
    if(Object.prototype.hasOwnProperty.call(update,'local_evento')) update.local_evento = limit(update.local_evento,300);
    if(Object.prototype.hasOwnProperty.call(update,'latitude')) update.latitude = numeroCoordenada(update.latitude);
    if(Object.prototype.hasOwnProperty.call(update,'longitude')) update.longitude = numeroCoordenada(update.longitude);
    if(Object.prototype.hasOwnProperty.call(update,'valor_sugerido_agenda')) update.valor_sugerido_agenda = valorNumericoOuNull(update.valor_sugerido_agenda);
    if(Object.prototype.hasOwnProperty.call(update,'valor_final_agenda')) update.valor_final_agenda = valorNumericoOuNull(update.valor_final_agenda);
    if(Object.prototype.hasOwnProperty.call(update,'valor_agenda_definido_por_admin')) update.valor_agenda_definido_por_admin = !!update.valor_agenda_definido_por_admin;
    if(Object.prototype.hasOwnProperty.call(update,'pais')) update.pais = text(update.pais);
    if(Object.prototype.hasOwnProperty.call(update,'uf')) update.uf = (update.pais === 'Outros' || update.pais === 'Internacional') ? '' : text(update.uf);
    if(Object.prototype.hasOwnProperty.call(update,'pais_codigo')) update.pais_codigo = limit(update.pais_codigo || codigoPaisMaps(update.pais),10);
    if(Object.prototype.hasOwnProperty.call(update,'unidade_codigo')) update.unidade_codigo = limit(update.unidade_codigo,20);
    if(Object.prototype.hasOwnProperty.call(update,'cidade')) update.cidade = limit(update.cidade,120);

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


app.get('/public/eventos', async (req,res)=>{
 try{
  const {data,error}=await getSupabase().from('eventos').select('id,tipo_servico,tipo_evento,divulgar_acesso_ouvintes,status_publicacao,status_operacao,titulo_original,titulo_publicado,descricao_original,descricao_publicada,site_oficial,link_ingressos,link_inscricao,link_programacao,link_acessibilidade,data_evento,duracao_horas,max_ouvintes,sala_codigo,pais,uf,pais_codigo,unidade_codigo,cidade,origem_transmissao,local_evento,latitude,longitude,created_at').eq('status_publicacao','aprovado').order('data_evento',{ascending:true});
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
  if(!servicoUsaTransmissao(ev.tipo_servico)) return res.status(400).json({error:'Este evento não é de transmissão Audesc.'});
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

  if(paisPagamentoEvento(ev).toLowerCase() !== 'brasil'){
   return res.status(400).json({error:'Mercado Pago está disponível apenas para eventos do Brasil. Para outros países, use o pagamento internacional.'});
  }

  const dadosPagamento = await calcularPagamentoEvento(ev, codigoCupom);
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
  if(paisPagamentoEvento(ev).toLowerCase() === 'brasil'){
   return res.status(400).json({error:'Paddle é usado apenas para pagamentos internacionais. Para Brasil, use Mercado Pago.'});
  }
  if(!['USD','EUR'].includes(dadosPagamento.moeda)) dadosPagamento.moeda = 'USD';

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

  if(!servicoUsaTransmissao(ev.tipo_servico)){
    console.log('PÓS-PAGAMENTO: evento não é de transmissão Audesc. Não será gerada sala.', eventoId);
    return { ok:false, skipped:true, reason:'Evento não é de transmissão Audesc.' };
  }

  if(ev.status_operacao === 'liberado' && ev.sala_codigo && ev.senha_transmissor){
    console.log('PÓS-PAGAMENTO: evento já estava liberado. Dados oficiais mantidos:', ev.sala_codigo);
    return { ok:true, already_liberated:true, evento:ev, sala_codigo:ev.sala_codigo, senha_transmissor:ev.senha_transmissor };
  }

  const senha = ev.senha_transmissor || await gerarSenhaUnica(sb);
  const sala = ev.sala_codigo || await gerarSalaUnica(sb);

  const { data: up, error: er } = await sb.from('eventos').update({
    status_publicacao: ev.status_publicacao || 'aprovado',
    status_pagamento: 'pago',
    status_operacao: 'liberado',
    senha_transmissor: senha,
    sala_codigo: sala,
    data_ultima_edicao: new Date().toISOString()
  }).eq('id', eventoId).select().single();

  if(er) throw er;

  try{
    await appendSheet(up, up.senha_transmissor, up.sala_codigo);
    await sb.from('eventos').update({
      planilha_liberacao_status:'salvo',
      planilha_liberacao_em:new Date().toISOString()
    }).eq('id', eventoId);
    console.log('PÓS-PAGAMENTO: dados salvos na planilha:', eventoId, up.sala_codigo);
  }catch(e){
    console.error('PÓS-PAGAMENTO: falha ao salvar na planilha:', e.message || e);
    try{
      await sb.from('eventos').update({
        planilha_liberacao_status:'erro',
        planilha_liberacao_erro:String(e && e.message ? e.message : e)
      }).eq('id', eventoId);
    }catch(_e){}
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
  const allowed = ['titulo_original','descricao_original','site_oficial','link_ingressos','link_inscricao','link_programacao','link_acessibilidade','data_evento','duracao_horas','max_ouvintes','tipo_evento','divulgar_acesso_ouvintes','tipo_servico','pais','uf','origem_transmissao','pais_codigo','unidade_codigo','cidade','local_evento','latitude','longitude'];
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
  if(Object.prototype.hasOwnProperty.call(update,'tipo_servico')){
   const tiposServicoValidos=listarTiposServicoValidos();
   const tipoSolicitado=text(update.tipo_servico);
   update.tipo_servico = tiposServicoValidos.includes(tipoSolicitado) ? tipoSolicitado : (ev.tipo_servico || 'audesc_transmissao');
   const evAtualizadoParaCalculo = {...ev, ...update};
   update.status_pagamento = await statusPagamentoInicial(evAtualizadoParaCalculo);
   update.status_agenda = SERVICOS_COM_AGENDA.includes(update.tipo_servico) ? 'pendente' : 'nao_aplicavel';
   update.status_operacao = 'nao_liberado';
  }
  if(Object.prototype.hasOwnProperty.call(update,'local_evento')) update.local_evento = limit(update.local_evento,300);
  if(Object.prototype.hasOwnProperty.call(update,'latitude')) update.latitude = numeroCoordenada(update.latitude);
  if(Object.prototype.hasOwnProperty.call(update,'longitude')) update.longitude = numeroCoordenada(update.longitude);
  if(Object.prototype.hasOwnProperty.call(update,'pais')) update.pais = text(update.pais);
  const paisFinalEdicao = Object.prototype.hasOwnProperty.call(update,'pais') ? update.pais : ev.pais;
  if(Object.prototype.hasOwnProperty.call(update,'uf')) update.uf = (paisFinalEdicao === 'Outros' || paisFinalEdicao === 'Internacional') ? '' : text(update.uf);
  if(Object.prototype.hasOwnProperty.call(update,'origem_transmissao')) update.origem_transmissao = paisFinalEdicao === 'Internacional' ? text(update.origem_transmissao) : '';
  else if(Object.prototype.hasOwnProperty.call(update,'pais') && paisFinalEdicao !== 'Internacional') update.origem_transmissao = '';
  if(Object.prototype.hasOwnProperty.call(update,'pais_codigo')) update.pais_codigo = limit(update.pais_codigo || codigoPaisMaps(paisFinalEdicao === 'Internacional' ? update.origem_transmissao : update.pais),10);
  if(Object.prototype.hasOwnProperty.call(update,'unidade_codigo')) update.unidade_codigo = limit(update.unidade_codigo,20);
  if(Object.prototype.hasOwnProperty.call(update,'cidade')) update.cidade = limit(update.cidade,120);
  const tipoServicoFinal = update.tipo_servico || ev.tipo_servico;
  const paisCodigoFinal = update.pais_codigo || paisCodigoEdicao;
  const unidadeCodigoFinal = update.unidade_codigo || unidadeCodigoEdicao;
  const localCfgFinal = resolverFormularioConfigParaLocal(formularioCfgEdicao, paisCodigoFinal, unidadeCodigoFinal);
  const houveMudancaDeServicoOuLocal = Object.prototype.hasOwnProperty.call(update,'tipo_servico') ||
   Object.prototype.hasOwnProperty.call(update,'pais') ||
   Object.prototype.hasOwnProperty.call(update,'uf') ||
   Object.prototype.hasOwnProperty.call(update,'pais_codigo') ||
   Object.prototype.hasOwnProperty.call(update,'unidade_codigo');
  if(houveMudancaDeServicoOuLocal && Array.isArray(localCfgFinal.servicosDisponiveis) && !localCfgFinal.servicosDisponiveis.includes(tipoServicoFinal)){
   return res.status(400).json({error:'Este tipo de solicitação não está disponível para o país e a unidade administrativa selecionados.'});
  }
  for(const campo of ['tipo_evento','divulgar_acesso_ouvintes','duracao_horas','max_ouvintes']){
   const valorAtual = Object.prototype.hasOwnProperty.call(update, campo) ? update[campo] : ev[campo];
   const valorCfg = valorConfiguradoPorServico(localCfgFinal, tipoServicoFinal, campo, valorAtual);
   if(valorCfg === null){
    update[campo] = null;
   }else if(campo === 'tipo_evento'){
    update[campo] = text(valorCfg) === 'publico' ? 'publico' : 'privado';
   }else if(campo === 'divulgar_acesso_ouvintes'){
    const tipoEventoFinal = update.tipo_evento || ev.tipo_evento;
    update[campo] = tipoEventoFinal === 'publico' && (valorCfg === true || text(valorCfg) === 'true');
   }else if(campo === 'duracao_horas'){
    update[campo] = Math.max(1, Math.min(8, Number(valorCfg || 1)));
   }else if(campo === 'max_ouvintes'){
    const n = Math.max(10, Math.min(500, Number(valorCfg || 10)));
    update[campo] = Math.ceil(n/10)*10;
   }
  }
  if((update.tipo_evento || ev.tipo_evento) === 'privado') update.divulgar_acesso_ouvintes = false;
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
