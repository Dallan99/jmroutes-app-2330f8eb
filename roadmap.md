# Roadmap — JM novo `zfmwojloamwggahjxlyt`

## Gate de segurança da parte 1
- [x] Credencial histórica removida dos arquivos atuais
- [x] Testes, tipos reais e bloqueio "módulo em implantação"
- [x] Admin dallanr@gmail.com via rotina privada
- [x] Testes de autopromoção, isolamento por base, imutabilidade e histórico
- [ ] Desativar cadastro público (painel do Supabase — ação do usuário)

## Fundação Meli (piloto isolado)
- [x] Etapa 1 — tabelas meli_piloto_* + ingestão idempotente (testada com rollback)
- [x] Etapa 2 — rotas /api/public/meli/piloto/ingest e /heartbeat (HMAC)
- [x] Etapa 3 — worker PILOT_WRITE (exige DRY_RUN), 4 bases, testes
- [ ] Segredo MELI_PILOTO_INGEST_SECRET no app e no Fly (usuário)
- [ ] Confirmar service center da ESP18 (worker: SSP25 "Atibaia"; app: Franco da Rocha)
- [ ] Publicar app com as rotas do piloto
- [ ] Etapa 4 — sessão AdminML no volume /data e fly deploy (usuário)
- [ ] Etapa 5 — relatório de comprovação da coleta real
- [ ] Etapa 6 — liberar Prévia de pagamentos lendo meli_piloto_rotas (após aprovação)

Parte 2: bloqueada. Fechamento/autorização de pagamento: bloqueados.
