# Análise arquitetural — tirar o coletor Meli do notebook Windows

Somente análise. Nada foi alterado em código, banco ou publicação.

## 1. O que hoje amarra o coletor ao notebook

Dependências reais do Windows (todas fora do código de negócio):
- `worker/meli/windows/*.cmd` e `*.ps1`: caminho fixo `C:\Program Files\nodejs\node.exe`, laços `timeout /t ... goto loop` como "reinício automático", `icacls`, gravação de `.env.local` e leitura do `.env` do projeto.
- `CONFIGURAR-COLETOR.cmd` / `setup-local.ps1`: cria as configurações e já executa o login do Mercado Livre.
- Início automático via tarefa do Windows (`instalar-inicio-automatico.ps1`).
- Logs em arquivos locais (`logs/worker-*.log`), sem coleta central.
- Arquivo de sessão do Mercado Livre em `worker/meli/data/adminml-session.enc`, só naquela máquina.

O código do coletor em si (`src/`) **já é multiplataforma**: usa Node + Playwright/Chromium, caminhos vindos de variáveis, e há Dockerfile e `fly.toml` prontos (imagem oficial do Playwright, volume `/data`, uma máquina sem escala a zero). Não há Puppeteer.

Processos hoje: um por base (`run-worker-base.cmd`) mais um do Painel Operacional (`run-dashboard-geral.cmd`, bases ESP15–ESP18). Todos compartilham o mesmo arquivo de sessão do Mercado Livre e o mesmo login técnico do JMRoutes (com trava de arquivo no token de renovação). Comunicação: HTTPS para o JMRoutes (`/api/public/meli/...`) com token do usuário técnico e para o Supabase apenas via chave pública — nunca chave de serviço.

## 2. Viabilidade de container Linux 24/7 na nuvem

Tecnicamente viável e já 80% preparado: container Linux com Chromium sem interface, volume persistente para a sessão cifrada, reinício automático pelo provedor. O que **não** é resolvido por infraestrutura:

- **Bloqueio de IP (risco número 1, já observado):** em teste anterior no Fly.io (IP dedicado, região São Paulo) o portal do Mercado Livre respondeu 403 para todas as chamadas. O bloqueio é por faixa de datacenter, não por IP específico. Sem contornar isso, migrar para nuvem pública derruba a coleta por completo. Alternativas: saída de rede residencial/empresarial (proxy da própria empresa ou proxy residencial contratado), ou hospedar o container num servidor dentro da rede da empresa (mini PC/servidor local Linux 24/7) — que já elimina a dependência do notebook sem trocar a faixa de IP.
- **Login com MFA:** o login exige pessoa + segundo fator. Em container isso só funciona com navegador visível acessível remotamente (Chromium com display virtual + acesso remoto tipo noVNC) — o que precisa ser construído, hoje não existe. Enquanto o Mercado Livre não fornecer API/token oficial para esses dados, a reautenticação humana eventual é inevitável.

Conclusão honesta: dá para ficar **100% automático no dia a dia** (execução, reinício, atualização, logs, telemetria); **não dá para ficar 100% automático na renovação de sessão** sem API oficial.

## 3. Arquivos a adaptar / que podem ficar

Precisam de adaptação:
- `Dockerfile`: hoje só executa o coletor de rotas (`dist/index.js`); precisa também do processo do Painel (`dist/monitoring-worker.js`) e de um supervisor simples de processos por base.
- Substituir `windows/*.cmd`/`*.ps1` por composição de containers (ou unidades systemd) com política de reinício e atraso escalonado por base.
- `fly.toml` (ou equivalente): hoje trava numa base só (ESP16, modo teste). Precisa das 15 bases, `DRY_RUN=false` e volume.
- `src/monitoring-worker.ts`: não tem recuperação de sessão (o de rotas tem); em nuvem, precisa sinalizar claramente "aguardando reconexão".
- Fluxo de login: novo caminho para reautenticação remota (navegador visível dentro do container com acesso protegido), ou procedimento de subir o arquivo de sessão gerado num computador para o volume.
- Logs: enviar para a saída padrão/coletor do provedor em vez de arquivos locais.

Podem permanecer sem mudança: `src/config.ts`, `src/session/store.ts`, `src/crypto.ts`, `src/pipeline/*`, `src/meli/*`, `src/telemetry/report.ts`, `scripts/auth.ts`, `src/state/breaker.ts` e toda a ingestão no JMRoutes (endpoints, RPCs, painéis).

## 4. Recursos mínimos
- 1 vCPU compartilhada e **1 GB de memória** por container de coleta (Chromium sem interface, concorrência 1); 2 GB confortável se juntar vários processos no mesmo container.
- Armazenamento: imagem do Playwright ~2 GB + volume de **1 GB** para sessão e estado.
- Rede: saída HTTPS estável; se usar proxy, contar a latência extra.
- Para as 15 bases + Painel num único host: ~2 vCPU e 4 GB é o piso realista, executando as bases em série/escalonadas.

## 5. Riscos e mitigação
| Risco | Mitigação |
| --- | --- |
| 403 por faixa de datacenter | testar antes num container isolado; usar servidor na rede da empresa ou proxy residencial/empresarial |
| Sessão vence e ninguém percebe | alerta no Painel e aviso automático (e-mail/mensagem) quando a última execução ficar em "aguardando autenticação" |
| Limite de requisições derruba a sessão | intervalo maior, concorrência 1, início escalonado — só configuração |
| Perda da chave da sessão | guardar no cofre de segredos; se perder, basta refazer o login |
| Migração quebrar a coleta atual | rodar nuvem e notebook em paralelo antes de desligar o notebook |
| Vários processos disputando a mesma sessão | manter a trava de arquivo já existente e volume único |

## 6. Plano de migração em etapas (com rollback)
1. **Prova de rede (1 dia):** container Linux no candidato (nuvem e/ou servidor local), somente leitura em modo teste, para verificar se o portal responde sem 403. *Rollback: descartar o container.*
2. **Ambiente e segredos:** criar volume e segredos no destino; nenhuma escrita no JMRoutes ainda. *Rollback: apagar app/volume.*
3. **Piloto de 1 base + Painel Operacional em paralelo** com o notebook ainda ativo, comparando números por 24–48 h. *Rollback: parar o container; o notebook continua sendo a fonte.*
4. **Migração das 15 bases** em lotes de 3–4, com início escalonado e monitoramento do limite de requisições. *Rollback por lote: devolver aquelas bases ao notebook.*
5. **Desligar o notebook** apenas depois de 7 dias estáveis; manter a instalação Windows pronta como plano B por mais 30 dias.
6. **Automação da reconexão:** navegador visível remoto protegido + alertas, para que a reautenticação leve minutos e possa ser feita de qualquer lugar. *Rollback: procedimento atual de gerar a sessão num computador e enviá-la ao volume.*

## 7. O que fica automático x o que ainda exige pessoa
- Automático: subir/reiniciar, atualizar versão, coletar as 15 bases, enviar snapshots, telemetria, logs, controle de ritmo e circuito, renovação do login técnico do JMRoutes.
- Ainda exige pessoa: login + MFA no portal do Mercado Livre quando a sessão vencer (frequência observada: algumas vezes por semana, agravada por excesso de chamadas). Só desaparece com API/token oficial do Mercado Livre — caminho que já existe iniciado no projeto (integração oficial com credenciais de aplicação) e é a única saída para 100% automático.

Nada implementado; aguardando sua decisão sobre o destino (nuvem com proxy x servidor Linux na rede da empresa).
