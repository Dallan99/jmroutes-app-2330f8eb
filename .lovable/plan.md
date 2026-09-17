# Diagnóstico — Painel Operacional parado (16–17/09/2026)

## Resumo da causa (já confirmada)
A sessão do coletor no portal do Mercado Livre (AdminML) venceu e passou a ser redirecionada para a tela de login (`sessao_expirada_redirecionada`). O coletor continua rodando a cada ~5 minutos, mas não lê nenhuma rota, então não envia snapshot algum. Nada foi rejeitado pelo banco; a proteção contra snapshot vazio não bloqueou nada.

- Última execução (tentativa): 17/09 01:39 UTC — ainda ativa.
- Última execução bem-sucedida: 16/09 20:42 UTC.
- Últimas gravações: ESP15 20:45, SSP20 20:45, SSP3 20:45, SSP38 20:45; ESP16/ESP17/ESP18 e demais 20:43–20:44; SSP37 já estava parada desde 15:51.
- Antes da queda: 44 ciclos com limite de requisições, 3 com sessão expirada e 2 com o circuito pausado — a sessão vinha sendo derrubada por excesso de chamadas.

## 1) Quem mantém a sessão AdminML
Não é o site JMRoutes nem o Supabase. É o **coletor instalado na máquina Windows da operação** (pasta `worker/meli`), que roda em duas janelas separadas:

- `windows/run-worker-base.cmd` — um processo por base (coleta de rotas/pacotes).
- `windows/run-dashboard-geral.cmd` — processo do Painel Operacional, configurado para **ESP15, ESP16, ESP17 e ESP18** — exatamente as bases do print. É esse processo que alimenta `meli_monitoramento_snapshots`.

A sessão é um navegador Chromium controlado pelo coletor, usando cookies salvos localmente e cifrados no arquivo `data/adminml-session.enc` (chave `WORKER_SESSION_KEY` em `.env.local`). O arquivo nunca vai para o Supabase nem para o site.

## 2) Arquivos e funções
- `worker/meli/src/session/login.ts` — `autenticarManualmente` (abre navegador visível para o operador fazer login + MFA) e `autenticarManualmenteCoordenado` (evita dois processos abrindo login ao mesmo tempo).
- `worker/meli/scripts/auth.ts` — script chamado por `npm run auth`, grava a sessão cifrada.
- `worker/meli/src/session/store.ts` — `salvarSessao` / `carregarSessao` (AES‑256‑GCM).
- `worker/meli/src/pipeline/auth.ts` — `abrirSessaoAdminML` (usa a sessão salva) e a parte JMRoutes/Supabase (`garantirSessaoJmroutes`, e-mail/senha do usuário técnico + refresh token em `data/jmr-session.enc`).
- `worker/meli/windows/setup-local.ps1` (`CONFIGURAR-COLETOR.cmd`) — configura `.env.local` e já executa o login do AdminML no final.
- `worker/meli/src/telemetry/report.ts` — grava a telemetria em `meli_worker_execucoes`.

## 3) Onde a expiração é detectada
- `pipeline/auth.ts` linhas 95–105: após abrir `envios.adminml.com/logistics/monitoring`, compara o domínio final; se mudou (redirecionado ao login), devolve `aguardando_autenticacao` com motivo `sessao_expirada_redirecionada` — é exatamente o que aparece no banco.
- `meli/list.ts` e `meli/risk.ts` sinalizam `sessao_expirada` em 401/403, o que abre o circuito.

## 4) Procedimento previsto hoje para reautenticar
- No coletor de rotas (`src/index.ts`, linhas 129–147 e 240–253) existe **recuperação assistida**: ao detectar sessão inválida, ele tenta abrir o navegador visível e espera até 10 minutos o operador logar.
- **Ponto importante:** o processo do Painel Operacional (`src/monitoring-worker.ts`, linha 25) **não** tem essa recuperação — ele apenas registra o aviso e espera 5 minutos, repetindo indefinidamente. Ou seja, sem alguém refazer o login na máquina, o Painel nunca volta sozinho.
- Procedimento documentado: rodar o login manual na máquina do coletor (`CONFIGURAR-COLETOR.cmd`, ou `npm run auth` na pasta `worker/meli`), concluir login e MFA no navegador que abrir, e reiniciar as duas janelas do coletor.

## 5) Dá para renovar pela interface do JMRoutes?
Não. Exige acesso à máquina/navegador do coletor: o login pede senha e MFA do Mercado Livre, e a sessão fica somente naquele computador. O site JMRoutes não tem (e por segurança não deveria ter) tela para isso.

## 6) Como confirmar que voltou
1. Na máquina do coletor, a janela do Painel Operacional deve passar a registrar "Snapshot do Dashboard Geral processado" (arquivo `logs/worker-DASHBOARD-GERAL.log`).
2. No JMRoutes, o "desatualizado há X min" das bases ESP15–ESP18 deve cair para poucos minutos em até ~2 ciclos (2–5 min).
3. Verificação técnica: a última execução em `meli_worker_execucoes` volta a `sucesso` com sessão `ok`, e a data de coleta mais recente por base em `meli_monitoramento_snapshots` passa a ficar dentro dos últimos minutos.

## 7) Reduzir o limite de requisições sem mexer em regra de negócio
Sim, apenas por configuração no `.env.local`/scripts da máquina do coletor, sem tocar em código, banco ou regras:
- aumentar `SYNC_INTERVAL_SECONDS` (ex.: 60 → 120/180) no processo do Painel e nos de base;
- definir `MONITORING_CONCURRENCY=1` (o coletor aceita 1–3; hoje o padrão é 3);
- escalonar o início dos processos por base (`run-worker-base.cmd` já aceita atraso inicial) para não disparar tudo junto;
- evitar rodar simultaneamente coletor e sessões manuais do AdminML no mesmo login.

## Procedimento recomendado (parar aqui, sem executar nada)
1. Acessar a máquina do coletor e rodar o login do AdminML (`CONFIGURAR-COLETOR.cmd` ou `npm run auth`), concluindo login + MFA.
2. Reiniciar as janelas do coletor (base e Painel Operacional).
3. Conferir os três pontos do item 6.
4. Depois de estabilizar, aplicar os ajustes de ritmo do item 7.
5. Melhoria opcional futura (requer autorização): dar ao processo do Painel a mesma recuperação assistida do coletor de rotas, e mostrar no Painel um aviso de "coleta aguardando reconexão" para os números antigos não parecerem atuais.

Nenhuma alteração foi feita: sem mudanças em código, banco, RPC, coletor, painéis, menu, credenciais ou publicação.
