# JMRoutes — Handoff Técnico (atualizado)

> Substitui o documento "JMRoutes_Handoff_Kimi_Manus.docx" (30/07/2026), que está
> defasado. Mantido aqui apenas o que corresponde ao estado real do código.

## 1. Ambiente

- Esta cópia é **homologação**. `APP_ENV=homologacao` bloqueia acesso à produção.
- Supabase de produção (`hcfjdbfqvihlnfacrttn`) **nunca** deve ser alterado.
- Supabase de homologação: `ieqvzndvkzozqvseubuc`.
- Não publicar em produção; trabalho sempre em branch separada.
- Gates 1 e 2 permanecem bloqueados (`.lovable/gates/`).

## 2. Stack real

React 19 + TanStack Start/Router, Vite 7, Bun, TypeScript strict, Tailwind v4,
shadcn/Radix, Supabase (RLS + RPCs SECURITY DEFINER), Vitest (testes de
caracterização + FakeSupabase). Backend roda em Worker (edge) — sem Django,
Java, Redis ou Postgres próprio.

## 3. Mapeamento de bases (ESP ↔ SSP)

| Base | Código | Service Center Meli |
| --- | --- | --- |
| Ibiúna | ESP15 | SSP20 |
| Guarujá | ESP16 | SSP15 |
| Embu Guaçu | ESP17 | SSP56 |
| Atibaia | ESP18 | SSP25 |

## 4. Ingestão Meli — estado atual

Dois caminhos coexistem:

1. **Extensão Chrome** (`chrome-extension/`) → `POST /api/public/meli/importar-rota-bruta`
   → RPC `meli_importar_rota` → `meli_rotas` / `meli_pacotes` / `meli_rotas_payload`.
2. **Worker externo** (`worker/meli/`, Fly.io, base piloto ESP16/SSP15) → coleta no
   AdminML via sessão Playwright cifrada → `/api/public/meli/ciclo` (protocolo de
   lotes: `meli_sync_ciclo_iniciar` / `_finalizar` / `_abandonar`) + telemetria em
   `meli_worker_execucoes`.

Chave de identidade da rota é sempre `routeId` — nunca o nome da rota.

## 5. Fase 2 — CONCLUÍDA (não refazer)

Fluxo implementado: rota Meli sincronizada → associação à base por
`bases.meli_service_center_id` → carga esperada em `escalas` com
`meli_pacote_id` preenchido → bipagem física no Recebimento
(`src/lib/recebimento.functions.ts` + `src/lib/recebimento-escala.server.ts`)
→ somente pacotes recebidos ficam elegíveis na Triagem
(`src/lib/triagem.functions.ts`).

## 6. Entregas posteriores à Fase 2

- **Romaneio Meli V3** (antes "Devoluções Meli"): migration
  `20260814230736_romaneio_devolucao_meli_v3.sql`, IDs sequenciais de recebimento,
  locks atômicos, RLS por base.
- **Sincronização de devoluções v2**: lista branca de códigos de retorno físico,
  fallback `revisao_necessaria`, idempotência (`sem_alteracao`), preservação de
  `recebido_na_base` / `divergencia_delivered` / `encerrado`.
- **Painel Operacional** e **Modo TV** (`/painel-operacional`, `/tv.*`).
- Dia operacional estritamente em `America/Sao_Paulo` (`src/lib/dia-operacional.ts`).

## 7. Invariantes que nunca podem ser violadas

- Sincronização Meli altera **apenas** `status_meli`. Estados físicos JM
  (recebimento, triagem, devolução) só mudam por bipagem física.
- Importação Meli ≠ recebimento físico.
- Toda operação de sync é idempotente: repetir não duplica rota, pacote, sessão
  ou leitura, e não apaga leituras existentes.
- Rota iniciada em dia anterior atualiza a rota original e **não** cria carga
  esperada no dia atual.
- Isolamento por base via RLS: usuário de uma base não lê nem opera outra.
- `tracking_id` sempre íntegro — nunca sintetizar `EXP-REC-...` como tracking.

## 8. Débitos conhecidos

- Worker ESP16 no Fly.io sofre bloqueio de rede/403 do AdminML a partir de IPs de
  datacenter; requer proxy residencial para voltar a coletar.
- Alguns testes de `transferencias.test.ts` falham por débito pré-existente
  (etapa "Saída do XPT" removida).

## 9. Checklist antes de qualquer publicação

1. Confirmar `APP_ENV=homologacao` e ausência de referência ao Supabase de produção.
2. Rodar testes e build; comparar falhas com os débitos da seção 8.
3. Confirmar que nenhum estado físico foi tocado por caminho de sync.
4. Testar sync repetida (idempotência) e rota de dia anterior finalizada hoje.
5. Testar usuário restrito a uma base.
6. Só então pedir autorização explícita ao Dallan.

## 10. Checkpoint — Dashboard Geral (2026-09-08)

- Regra confirmada: somente códigos `ESP` são XPT; `SSP` e `SSC` são Services.
- 15 unidades ativas na planilha oficial: 4 XPTs e 11 Services.
- A resposta real de `get-routes-list` contém, por rota, `facilityId`,
  `serviceCenterId`, tipo/status e os contadores `total`, `totalBags`, `pending`,
  `notDelivered` e `delivered`. Não é necessário abrir detalhes de pacotes para
  reproduzir o quadro superior do Monitoramento Last Mile.
- O worker filtra pela unidade operacional real (`facilityId`) e envia o resumo
  para `/api/public/meli/importar-monitoramento`.
- O Dashboard Geral lê `meli_monitoramento_snapshots` e apresenta veículos,
  pacotes, entregas, DC, sinistro, insucessos normais, PNR e as três performances
  da planilha; o Dashboard XPTs existente permanece independente.
- Migrations remotas registradas/aplicadas: `20260908142535`, `20260908162145`,
  `20260908221127` e `20260908221509`.
- Validação: build do site passou; worker com 29 testes, typecheck e build verdes.
  A suíte completa do site tem 3 falhas anteriores e alheias ao dashboard em
  `app-motorista-vinculo-meli.test.ts` (textos de caracterização desatualizados).
- Próximo passo após o push/publicação: publicar no Lovable e só então reinstalar
  os quatro grupos do worker pelo script
  `worker/meli/windows/instalar-inicio-automatico.ps1`.
