const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const SHEET_NAME = process.env.SHEET_NAME || 'eventos';

function normalizarTexto(value) {
  return String(value || '').trim();
}

function gerarSenha(tamanho = 8) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let senha = '';
  for (let i = 0; i < tamanho; i++) {
    senha += alfabeto[crypto.randomInt(0, alfabeto.length)];
  }
  return senha;
}

function gerarSala(titulo) {
  const base = normalizarTexto(titulo)
    .toLowerCase()
    .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'evento';
  return 'audesc-' + base + '-' + crypto.randomBytes(3).toString('hex');
}

function calcularFim(dataEvento, duracaoHoras) {
  if (!dataEvento) return '2026-12-31T23:59:59-03:00';
  const inicio = new Date(dataEvento);
  const horas = Number(duracaoHoras || 2);
  const fim = new Date(inicio.getTime() + horas * 60 * 60 * 1000);
  return fim.toISOString();
}

function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configurados.');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function getSheets() {
  if (!GOOGLE_SHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error('Variáveis do Google Sheets não configuradas.');
  }

  const auth = new google.auth.JWT({
    email: GOOGLE_CLIENT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  return google.sheets({ version: 'v4', auth });
}

async function adicionarLinhaNaPlanilha(evento, senha, sala) {
  const sheets = await getSheets();

  const titulo = evento.titulo_publicado || evento.titulo_original || 'Evento Audesc';
  const inicio = evento.data_evento || new Date().toISOString();
  const fim = calcularFim(inicio, evento.duracao_horas);

  const linha = [
    senha,
    sala,
    titulo,
    evento.max_ouvintes || 20,
    evento.duracao_horas || 2,
    inicio,
    fim,
    'ativo',
    'sim',
    10,
    '',
    '',
    '',
    ''
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:N`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [linha]
    }
  });
}

function checarAdmin(req, res) {
  const token = req.headers['x-admin-token'] || req.query.admin_token;
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    res.status(403).json({ error: 'Acesso administrativo não autorizado.' });
    return false;
  }
  return true;
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'audesc-integrador-eventos', version: 'v1' });
});

async function liberarEvento(req, res) {
  try {
    if (!checarAdmin(req, res)) return;

    const id = req.params.id;
    const supabase = getSupabase();

    const { data: evento, error } = await supabase
      .from('eventos')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !evento) {
      return res.status(404).json({ error: 'Evento não encontrado.' });
    }

    if (evento.status_publicacao !== 'aprovado') {
      return res.status(400).json({ error: 'Evento ainda não está aprovado.' });
    }

    if (evento.tipo_servico === 'audesc_transmissao' && evento.status_pagamento !== 'pago') {
      return res.status(400).json({ error: 'Evento ainda não consta como pago.' });
    }

    if (evento.tipo_servico === 'divulgacao_gratuita') {
      const { data: atualizado, error: updateError } = await supabase
        .from('eventos')
        .update({
          status_operacao: 'liberado',
          data_ultima_edicao: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      return res.json({
        ok: true,
        tipo: 'divulgacao_gratuita',
        evento: atualizado
      });
    }

    const senha = evento.senha_transmissor || gerarSenha(8);
    const sala = evento.sala_codigo || gerarSala(evento.titulo_publicado || evento.titulo_original);

    await adicionarLinhaNaPlanilha(evento, senha, sala);

    const { data: atualizado, error: updateError } = await supabase
      .from('eventos')
      .update({
        senha_transmissor: senha,
        sala_codigo: sala,
        status_operacao: 'liberado',
        data_ultima_edicao: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    return res.json({
      ok: true,
      tipo: 'audesc_transmissao',
      senha_transmissor: senha,
      sala_codigo: sala,
      evento: atualizado
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Erro ao liberar evento.' });
  }
}

app.post('/liberar-evento/:id', liberarEvento);

// endpoint GET para facilitar teste manual pelo navegador, protegido por admin_token
app.get('/liberar-evento/:id', liberarEvento);

app.listen(PORT, () => {
  console.log(`Audesc Integrador de Eventos rodando na porta ${PORT}`);
});
