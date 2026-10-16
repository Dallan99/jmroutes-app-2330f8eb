# Fase B4 — Runbook de deploy do worker Meli no Fly.io (DRY_RUN)

Este runbook precisa ser executado **por você**, na sua máquina, com `flyctl`
autenticado. O ambiente do Lovable não tem `flyctl`, Docker, nem token do
Fly.io — portanto nenhuma app, volume, secret ou deploy foi criado aqui.

Nenhum comando abaixo deve ter sua saída colada em chat, commit ou log:
os passos 1, 3 e 4 manipulam segredos.

## 0. Pré-requisitos

```bash
brew install flyctl          # ou: curl -L https://fly.io/install.sh | sh
fly auth login
cd worker/meli
```

## 1. Redefinir a senha do usuário técnico (manual, obrigatório)

A senha da Fase B3 não foi persistida em lugar algum. Redefina:

1. Supabase Dashboard → Authentication → Users
2. localize `worker.meli.esp16@jmroutes.local`
3. menu `...` → **Reset password** / **Update user** → defina uma senha nova
   forte (32+ caracteres, gerada por gerenciador de senhas ou
   `openssl rand -base64 32`)
4. cole o valor **apenas** no passo 4 (`fly secrets set WORKER_PASSWORD=...`)

Não grave essa senha em arquivo, `.env`, código ou histórico de chat.
Dica: no shell, prefixe o comando com um espaço para não gravar no histórico.

## 2. Criar a aplicação e o volume

```bash
fly apps create jmroutes-meli-worker-esp16
fly volumes create meli_session --region gru --size 1 --app jmroutes-meli-worker-esp16
```

Uma única máquina, sem scale-to-zero (o `fly.toml` não declara `http_service`,
logo não há autostop/autostart).

## 3. Gerar a WORKER_SESSION_KEY (32 bytes aleatórios)

```bash
openssl rand -base64 32
```

Guarde o valor apenas no cofre do Fly.io (passo 4) e no seu gerenciador de
senhas. Se essa chave for perdida, o arquivo de sessão cifrado torna-se
ilegível e basta refazer a autenticação manual.

## 4. Secrets do Fly.io

```bash
 fly secrets set --app jmroutes-meli-worker-esp16 \
   SUPABASE_ANON_KEY='<anon/publishable key do projeto zfmwojloamwggahjxlyt>' \
   WORKER_EMAIL='worker.meli.esp16@jmroutes.local' \
   WORKER_PASSWORD='<senha definida no passo 1>' \
   WORKER_SESSION_KEY='<base64 do passo 3>'
```

Variáveis **não** sensíveis já estão versionadas em `fly.toml` (`[env]`):
`JMR_BASE_URL`, `SUPABASE_URL`, `BASE_CODE=ESP16`, `SERVICE_CENTER_ID=SSP15`,
`SITE_ID=MLB`, `SESSION_FILE_PATH=/data/adminml-session.enc`,
`SYNC_INTERVAL_SECONDS=60`, `DRY_RUN=true`.

## 5. Build local e deploy

```bash
npm ci
npm run typecheck
npm test
npm run build
docker build -t jmroutes-meli-worker-esp16:b4 .
fly deploy --app jmroutes-meli-worker-esp16
```

## 6. Validação esperada após o deploy

```bash
fly status   --app jmroutes-meli-worker-esp16   # 1 máquina, região gru, 1GB
fly volumes  list --app jmroutes-meli-worker-esp16
fly secrets  list --app jmroutes-meli-worker-esp16   # só nomes/digest
fly logs     --app jmroutes-meli-worker-esp16
```

Nos logs, o esperado no primeiro ciclo:

- configuração aceita para `ESP16 / SSP15 / MLB` (qualquer outra base derruba o
  processo com `ConfigError` — é o comportamento correto);
- `DRY_RUN=true` visível apenas como estado, sem segredos;
- `status = aguardando_autenticacao` (não existe
  `/data/adminml-session.enc` ainda);
- container **saudável**, sem crash loop — o worker repete o ciclo a cada
  `SYNC_INTERVAL_SECONDS` aguardando a sessão.

Em DRY_RUN o worker **não** chama `/api/public/meli/importar-rota-bruta` e
**não** grava telemetria, portanto `meli_rotas` e `meli_pacotes` não mudam.

## 7. PARAR aqui

Não faça login no AdminML nesta fase. O próximo passo exige sua participação
(login + MFA).

## 8. Próxima fase — autenticação manual no AdminML

O login é **headful** e precisa de display; roda na sua máquina, não no
container:

```bash
cd worker/meli
WORKER_SESSION_KEY='<a mesma chave do passo 3>' \
SESSION_FILE_PATH=./data/adminml-session.enc \
npm run auth
```

Fluxo: abre o navegador controlado → você faz login + MFA no AdminML → o worker
captura o `storageState` → cifra com AES-256-GCM → grava o arquivo.

Depois é preciso colocar esse arquivo no volume do Fly.io:

```bash
fly ssh sftp shell --app jmroutes-meli-worker-esp16
# put ./data/adminml-session.enc /data/adminml-session.enc
fly machine restart <machine-id> --app jmroutes-meli-worker-esp16
```

A senha do Mercado Livre **nunca** é armazenada — apenas o `storageState`
cifrado da sessão.
