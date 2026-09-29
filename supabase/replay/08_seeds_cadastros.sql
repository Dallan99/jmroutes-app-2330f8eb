-- =============================================================================
-- SEED 1/2 — CADASTROS NECESSARIOS PARA O SISTEMA FUNCIONAR
-- Executar DEPOIS dos 7 lotes de estrutura, no banco novo.
-- Mantem os mesmos identificadores (uuid) do banco atual, para que o historico
-- exportado (rotas, devolucoes, monitoramento) continue apontando para a base
-- certa.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Bases (17) — fonte oficial do painel
-- -----------------------------------------------------------------------------
insert into public.bases (id, codigo, nome, cidade, uf, ativa, meli_service_center_id, meli_site_id) values
  ('17ca959c-a18e-4fe1-8ce6-69d3d84810b5', 'ESP15', 'XPT Ibiúna',        'Ibiúna',          'SP', true, 'ESP15', 'MLB'),
  ('a5ae8637-1e33-40e3-8fdb-d1a464628ab9', 'ESP16', 'XPT Guarujá',       'Guarujá',         'SP', true, 'ESP16', 'MLB'),
  ('e4e9b675-6cff-4d6b-b7db-684573f58294', 'ESP17', 'XPT São Lourenço',  'São Lourenço',    'SP', true, 'ESP17', 'MLB'),
  ('4e435193-3b65-447c-9b97-9518ae72bca3', 'ESP18', 'XPT Franco da Rocha','Franco da Rocha','SP', true, 'ESP18', 'MLB'),
  ('e4fa4e91-bd4a-4d38-aecf-8ffad805ceb4', 'SSC2',  'Biguaçu',           'Biguaçu',         'SC', true, 'SSC2',  null),
  ('b2ba19b9-8b78-4244-987c-b9aa995f3f86', 'SSP15', 'Santos',            'Santos',          'SP', true, 'SSP15', null),
  ('178b5d37-9970-4880-918e-c64f0c249726', 'SSP17', 'ABC',               'Santo André',     'SP', true, 'SSP17', null),
  ('98ffcedf-e71e-41ae-ad26-df52ab65a459', 'SSP20', 'Sorocaba',          'Sorocaba',        'SP', true, 'SSP20', null),
  ('05556982-4523-4fe2-8071-7ad5832e24f4', 'SSP23', 'Suzano',            'Suzano',          'SP', true, 'SSP23', null),
  ('dad5184c-7c2a-45ad-854b-07f6b209f698', 'SSP3',  'Campinas',          'Campinas',        'SP', true, 'SSP3',  null),
  ('1700ce1b-21e6-4919-b50d-c3f9634d0b1a', 'SSP37', 'Campinas',          'Campinas',        'SP', true, 'SSP37', null),
  ('1298682d-630f-4242-b6c9-0c18d942305d', 'SSP38', 'Itupeva',           'Itupeva',         'SP', true, 'SSP38', null),
  ('da0b7bc4-a8c8-41e5-ad31-cf996c6acea7', 'SSP4',  'Cravinhos',         'Cravinhos',       'SP', true, 'SSP4',  null),
  ('2cdab3b0-4da2-47ed-9654-47892ee3c0cf', 'SSP45', 'Itaquera',          'São Paulo',       'SP', true, 'SSP45', null),
  ('9a199f27-90d9-4e39-9541-2211de7cdc8e', 'SSP5',  'Mega Barueri',      'Barueri',         'SP', true, 'SSP5',  null),
  ('763b739f-d781-46d8-8a68-6bb17da79f95', 'SSP6',  'Mauá',              'Mauá',            'SP', true, 'SSP6',  null),
  ('cbac6170-2a2d-49cc-a418-ac0c592bed18', 'SSP7',  'Lapa',              'São Paulo',       'SP', true, 'SSP7',  null)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Unidades operacionais do Meli (20) — liga cada codigo do Meli a uma base
-- -----------------------------------------------------------------------------
insert into public.meli_unidades_operacionais (codigo, nome, cidade, uf, tipo, service_center_id, ativo, ordem)
select v.codigo, v.nome, v.cidade, v.uf, v.tipo, v.service_center_id, v.ativo, v.ordem
from (values
  ('SSP3',  'Campinas',          'Campinas',   'SP', 'SERVICE', 'SSP3',  true,  10),
  ('SSP38', 'Itupeva',           'Itupeva',    'SP', 'SERVICE', 'SSP38', true,  20),
  ('ESP15', 'XPT Ibiúna',        'Ibiúna',     'SP', 'XPT',     'SSP20', true,  30),
  ('SSP5',  'Mega Barueri',      'Barueri',    'SP', 'SERVICE', 'SSP5',  true,  40),
  ('SSP20', 'Sorocaba',          'Sorocaba',   'SP', 'SERVICE', 'SSP20', true,  50),
  ('ESP17', 'XPT Embu Guaçu',    'Embu Guaçu', 'SP', 'XPT',     'SSP56', true,  60),
  ('SSP56', 'XPT Embu Guaçu',    'Embu-Guaçu', 'SP', 'XPT',     'SSP56', false, 60),
  ('ESP16', 'XPT Guarujá',       'Guarujá',    'SP', 'XPT',     'SSP15', true,  70),
  ('SSP17', 'ABC',               'Santo André','SP', 'SERVICE', 'SSP17', true,  80),
  ('ESP18', 'Atibaia',           'Atibaia',    'SP', 'XPT',     'SSP25', true,  90),
  ('SSP6',  'Mauá',              'Mauá',       'SP', 'SERVICE', 'SSP6',  true, 100),
  ('SSP45', 'Itaquera',          'São Paulo',  'SP', 'SERVICE', 'SSP45', true, 110),
  ('SSP15', 'Santos',            'Santos',     'SP', 'SERVICE', 'SSP15', true, 120),
  ('SSP37', 'Campinas',          'Campinas',   'SP', 'SERVICE', 'SSP37', true, 130),
  ('SSP23', 'Suzano',            'Suzano',     'SP', 'SERVICE', 'SSP23', true, 140),
  ('SSC2',  'Biguaçu',           'Biguaçu',    'SC', 'SERVICE', 'SSC2',  true, 150),
  ('SSP25', 'Atibaia',           'Atibaia',    'SP', 'SERVICE', 'SSP25', false,150),
  ('SFC1',  'Itupeva SFC',       'Itupeva',    'SP', 'SERVICE', 'SFC1',  false,160),
  ('SSP4',  'Cravinhos',         'Cravinhos',  'SP', 'SERVICE', 'SSP4',  false,160),
  ('SSP7',  'Lapa',              'São Paulo',  'SP', 'SERVICE', 'SSP7',  false,170)
) as v(codigo, nome, cidade, uf, tipo, service_center_id, ativo, ordem)
where not exists (
  select 1 from public.meli_unidades_operacionais u where u.codigo = v.codigo
);

-- -----------------------------------------------------------------------------
-- Codigos de ocorrencia do Meli (10) — traduzem falha em motivo na tela
-- -----------------------------------------------------------------------------
insert into public.meli_ocorrencia_codigos (codigo, descricao, peso, responsabilidade, ativo)
select v.codigo, v.descricao, v.peso, null, true
from (values
  ('bad_address',         'Faltam dados do endereço'),
  ('business_closed',     'Negócio fechado'),
  ('buyer_absent',        'Não havia ninguém no endereço'),
  ('buyer_rejected',      'O pacote foi recusado'),
  ('damaged',             'O pacote está avariado'),
  ('inaccessible_address','Fica em uma área inacessível'),
  ('missing',             'O pacote foi perdido'),
  ('missrouted',          'O pacote não pertence à minha região'),
  ('transferred',         'Transferido'),
  ('unvisited_address',   'Endereço não visitado')
) as v(codigo, descricao)
where not exists (
  select 1 from public.meli_ocorrencia_codigos c where c.codigo = v.codigo
);

commit;
