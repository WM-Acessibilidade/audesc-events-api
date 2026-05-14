const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const crypto = require('crypto');

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
function admin(req,res){ const t=req.headers['x-admin-token']||req.query.admin_token; if(!ADMIN_TOKEN || t!==ADMIN_TOKEN){res.status(403).json({error:'Acesso administrativo não autorizado.'}); return false;} return true; }

app.get('/health',(req,res)=>res.json({ok:true,service:'audesc-events-api',version:'v14-meus-eventos-seguro'}));

app.post('/criar-evento', async (req,res)=>{
 try{
  const user=await getUser(req);
  if(!user) return res.status(401).json({error:'E-mail ainda não verificado. Solicite e confirme o código antes de cadastrar o evento.'});
  const b=req.body||{};
  if(text(b.website)) return res.status(400).json({error:'Solicitação inválida.'});
  const tipo_servico=text(b.tipo_servico)==='divulgacao_gratuita'?'divulgacao_gratuita':'audesc_transmissao';
  const tipo_evento=text(b.tipo_evento)==='publico'?'publico':'privado';
  const titulo=limit(b.titulo_original,200);
  if(!titulo) return res.status(400).json({error:'Informe o nome do evento.'});
  const duracao_horas=Math.max(1,Math.min(8,Number(b.duracao_horas||2)));
  const max_ouvintes=Math.max(10,Math.min(500,Number(b.max_ouvintes||20)));
  const ev={user_id:user.id,email_usuario:user.email,tipo_servico,tipo_evento,status_publicacao:tipo_evento==='publico'?'pendente':'aprovado',status_pagamento:tipo_servico==='divulgacao_gratuita'?'dispensado':'pendente',status_operacao:'nao_liberado',titulo_original:titulo,descricao_original:limit(b.descricao_original,5000),site_oficial:safeUrl(b.site_oficial),link_ingressos:safeUrl(b.link_ingressos),link_programacao:safeUrl(b.link_programacao),link_acessibilidade:safeUrl(b.link_acessibilidade),pais: text(b.pais)==='Outro' ? text(b.pais_outro) : text(b.pais),
      uf: text(b.pais)==='Outros' ? '' : text(b.uf),
      data_evento:b.data_evento||null,duracao_horas,max_ouvintes};
  const {data,error}=await getSupabase().from('eventos').insert(ev).select().single();
  if(error) throw error;
  res.json({ok:true,mensagem:tipo_evento==='publico'?'Evento recebido e enviado para curadoria antes da publicação.':'Evento recebido.',evento:data});
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

async function liberar(req,res){
 try{
  if(!admin(req,res)) return;
  const sb=getSupabase();
  const {data:ev,error}=await sb.from('eventos').select('*').eq('id',req.params.id).single();
  if(error||!ev) return res.status(404).json({error:'Evento não encontrado.'});
  if(ev.status_publicacao!=='aprovado') return res.status(400).json({error:'Evento ainda não está aprovado.'});
  if(ev.tipo_servico==='audesc_transmissao' && ev.status_pagamento!=='pago') return res.status(400).json({error:'Evento ainda não consta como pago.'});
  if(ev.tipo_servico==='divulgacao_gratuita'){
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
      'link_programacao',
      'link_acessibilidade',
      'data_evento',
      'duracao_horas',
      'max_ouvintes',
      'tipo_servico',
      'tipo_evento',
      'pais',
      'uf'
    ];
    const update = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
        update[key] = req.body[key];
      }
    }
    update.editado_por_admin = true;
    update.data_ultima_edicao = new Date().toISOString();

    const { data, error } = await getSupabase()
      .from('eventos')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ ok: true, evento: data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Erro ao atualizar evento.' });
  }
});


app.get('/public/eventos', async (req,res)=>{
 try{
  const {data,error}=await getSupabase().from('eventos').select('id,tipo_servico,tipo_evento,status_publicacao,status_operacao,titulo_original,titulo_publicado,descricao_original,descricao_publicada,site_oficial,link_ingressos,link_programacao,link_acessibilidade,data_evento,duracao_horas,max_ouvintes,sala_codigo,pais,uf,created_at').eq('status_publicacao','aprovado').order('data_evento',{ascending:true});
  if(error) throw error; res.json({ok:true,eventos:data||[]});
 }catch(e){console.error(e);res.status(500).json({error:e.message||'Erro ao listar eventos públicos.'})}
});


app.post('/notificacoes/solicitar', async (req,res)=>{
 try{
  const b=req.body||{};
  if(text(b.website)) return res.status(400).json({error:'Solicitação inválida.'});
  const email=text(b.email).toLowerCase();
  if(!email || !email.includes('@')) return res.status(400).json({error:'Informe um e-mail válido.'});
  const payload={email,receber_todos:!!b.receber_todos,pais:text(b.pais),uf:text(b.uf),eventos_ids:Array.isArray(b.eventos_ids)?b.eventos_ids:[],updated_at:new Date().toISOString()};
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
  if(ev.tipo_servico !== 'audesc_transmissao') return res.status(400).json({error:'Este evento não é de transmissão Audesc.'});
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

  res.json({ok:true,email,total:data.length,eventos:data});
 }catch(e){
  console.error(e);
  res.status(500).json({error:e.message || 'Erro ao carregar eventos.'});
 }
});


app.listen(PORT,()=>console.log(`Audesc Events API rodando na porta ${PORT}`));
