-- Fase 6: serviços múltiplos por evento
alter table public.eventos add column if not exists servicos_solicitados jsonb not null default '[]'::jsonb;

update public.eventos
set servicos_solicitados = case
  when tipo_servico = 'audesc_com_audiodescritor' then '["audesc_transmissao","somente_audiodescritor"]'::jsonb
  when tipo_servico is not null and trim(tipo_servico) <> '' then jsonb_build_array(tipo_servico)
  else '[]'::jsonb
end
where servicos_solicitados = '[]'::jsonb;

comment on column public.eventos.servicos_solicitados is 'Lista de componentes de atendimento selecionados pelo usuário. tipo_servico é mantido temporariamente para compatibilidade.';
