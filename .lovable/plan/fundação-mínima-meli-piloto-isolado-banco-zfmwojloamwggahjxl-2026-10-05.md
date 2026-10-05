# Fundação mínima Meli (piloto isolado) — banco zfmwojloamwggahjxlyt

## Situação atual (verificada)
- O banco novo não tem nenhuma tabela Meli. A Prévia de pagamentos e o Cadastro de veículos mostram "Módulo em implantação".
- O worker (`worker/meli`) hoje, em DRY_RUN=true, **não grava nada**: só consulta o AdminML. Para alimentar o piloto, ele precisa de um novo modo de escrita restrito.
- O worker envia dados por rotas do app (`/api/public/meli/ciclo`, `importar-rota-bruta`) e pela RPC `meli_worker_registrar_execucao`. Essas rotas estão hoje bloqueadas pelo guard de módulos.
- O caminho da sessão já é `/data/adminml-session.enc`, no volume `meli_session` do Fly. O `fly.toml` está apontado ao banco novo, mas configurado só para ESP16/SSP15.
- Eu não consigo implantar no Fly, criar a sessão AdminML nem executar a coleta real daqui. Essas etapas dependem de você (ver Etapa 4).

## Etapa 1 — Estrutura no banco (uma migration, BEGIN/COMMIT, idempotente)
Tudo no prefixo `meli_piloto_`, sem FK nem trigger para tabelas operacionais (rotas, escalas, recebimentos, pagamentos).

- `meli_piloto_ciclos`: uma linha por execução de coleta (base, service center, início/fim, status, DRY_RUN, versão do worker, total de páginas esperado/lido, total de rotas/pacotes esperado/recebido, erro).
- `meli_piloto_paginas`: controle de paginação por ciclo (página, offset, total informado pelo AdminML, itens recebidos, hash do payload, status). Única por (ciclo, página).
- `meli_piloto_staging`: payload bruto (jsonb), hash, horário da coleta, ciclo e página. Único por (ciclo, hash).
- `meli_piloto_rotas`: base (ESP15–18), data da rota, `route_id`, `driver_id`, nome do motorista, placa, total de pedidos, total entregue, payload bruto, coletado_em, primeiro/último ciclo. **Único por (route_id, data_rota)**. Gravação por upsert.
- `meli_piloto_pacotes`: `shipment_id`, `route_id`, status, payload bruto, coletado_em. **Único por (shipment_id, route_id)**.
- `meli_piloto_erros`: ciclo, etapa, código, mensagem, payload resumido.
- `meli_piloto_heartbeat`: uma linha por instância do worker (base, host/região Fly, versão, último sinal, estado da sessão AdminML válida/expirada, DRY_RUN). Confirma que o worker roda na nuvem e não num computador.
- RLS ativa em todas. Leitura: admin/gerente/supervisor, e operadores apenas das suas bases. Nenhuma escrita por `anon` ou `authenticated`.
- Escrita somente por rotina `privado.meli_piloto_ingerir_lote(...)` (SECURITY DEFINER, `search_path=''`, sem EXECUTE para PUBLIC), chamada só pelo servidor do app.

## Etapa 2 — Entrada do worker no app
- Nova rota `POST /api/public/meli/piloto/ingest` e `POST /api/public/meli/piloto/heartbeat`.
- Autenticação por assinatura HMAC do corpo com segredo gerado pelo app (`MELI_PILOTO_INGEST_SECRET`, gerado por mim e cadastrado no Fly por você). Sem usuário técnico e sem senha.
- Validação Zod, limite de tamanho e base restrita a ESP15–ESP18.
- A rota grava **apenas** nas tabelas `meli_piloto_*`. As rotas antigas (`ciclo`, `importar-rota-bruta`) continuam bloqueadas.
- Liberar só essas tabelas e a rotina no guard (`TABELAS_IMPLANTADAS`).

## Etapa 3 — Ajuste do worker
- Novo modo `PILOT_WRITE=true`, que só é aceito com `DRY_RUN=true`. Envia lotes e heartbeat apenas para as rotas do piloto. Qualquer outra escrita continua bloqueada pelo DRY_RUN.
- Uma instância cobrindo as 4 bases (ESP15/16/17/18 e seus service centers), em sequência.
- Cada ciclo registra páginas esperadas/lidas e totais. Ao final, compara esperado vs. recebido.
- Testes do worker: idempotência (reenvio do mesmo lote não duplica), paginação completa, PILOT_WRITE recusado sem DRY_RUN.

## Etapa 4 — Coleta real (depende de você)
1. Confirmar os service centers de ESP15, ESP17 e ESP18. Hoje só conheço ESP16 = SSP15.
2. Gerar a sessão AdminML cifrada e enviá-la ao volume `/data/adminml-session.enc` no Fly.
3. Cadastrar no Fly os segredos `WORKER_SESSION_KEY` e `MELI_PILOTO_INGEST_SECRET`, e ligar `PILOT_WRITE=true` com `DRY_RUN=true`.
4. Implantar com `fly deploy`. Desligue o computador local durante o teste.

## Etapa 5 — Relatório de comprovação (eu executo pelo banco)
- Heartbeat vindo da região `gru` do Fly, com o computador desligado.
- Sessão AdminML marcada como válida no heartbeat.
- Por ciclo e base: páginas esperadas = páginas lidas.
- Rotas e pacotes esperados = recebidos.
- Zero duplicidade (contagem por chave única = contagem total).
- Percentual de rotas com motorista, placa, pedidos e entregues preenchidos, por base.

## Etapa 6 — Liberar a Prévia de pagamentos (somente após aprovação do relatório)
- Prévia lê `meli_piloto_rotas` em vez de `meli_rotas`.
- Aplicar a proposta de pagamentos (tarifas R$ 200/300/500, veículos, adicionais) numa migration separada.
- Fechamento e autorização de pagamento continuam bloqueados (sem botões, sem rotina de fechamento).

## Fora do escopo
Parte 2 (transferências/inventário), importação de histórico, escrita em tabelas operacionais, Cron e retirada do DRY_RUN.

## Riscos
- Limite do banco gratuito (500 MB): payload bruto de pacotes cresce rápido. Proposta: guardar o bruto por 7 dias em staging e manter só os campos extraídos depois.
- A sessão AdminML pode expirar. O heartbeat mostra isso, mas a renovação continua manual.
