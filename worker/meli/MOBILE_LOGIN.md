# Iniciador móvel do Meli

## Ambiente conferido em 15/10/2026

O painel autenticado da Fly mostra o app `jmroutes-meli-worker-esp16`, release
v62, máquina `d8946d0f7360d8` em GRU, volume `meli_session` em `/data`,
`JMR_BASE_URL=https://jmroutes.app` e
`SUPABASE_URL=https://zfmwojloamwggahjxlyt.supabase.co`. O processo atual usa
`DRY_RUN=true` com `PILOT_WRITE=true` e treze bases. Logs recentes mostram ciclos
do piloto concluídos com `sessao_expirada=false`. Isso confirma coleta do
piloto, não a publicação operacional nem a atualização de todos os módulos.

A implementação foi reconciliada com a branch `fix/dashboard-piloto-meli`,
que contém o protocolo do piloto e os códigos SSP06/SSP37/03. A configuração
efetiva contém ainda um health check na porta 9394, que não existe nessa branch;
não se assume equivalência completa entre o código GitHub e a imagem v62.
O arquivo de exemplo móvel preserva o destino e o modo piloto conferidos.

Abre uma tela remota do login oficial no navegador do Android ou iPhone. O
operador digita no navegador remoto e aprova pessoalmente o Okta Verify. A
sessão cifrada fica no mesmo servidor/volume dos coletores; o notebook pode
ficar desligado. Não é necessário APK. Adicione o endereço à tela inicial.

## O que esta alteração entrega

- Página restrita por uma chave administrativa aleatória com no mínimo 32
  caracteres, cookie HttpOnly/Secure/SameSite, proteção de origem e CSRF,
  expiração de acesso em 30 minutos e limite de tentativas de entrada.
- Uma sessão de login remoto por vez, encerrada após dez minutos. Nenhuma
  senha do Meli é persistida pelo iniciador. Capturas de tela são transitórias,
  autenticadas e sem cache. Não publique gravações, cookies ou chaves em logs.
- Validação por resposta JSON de sucesso da lista operacional do Meli. HTML,
  redirecionamento, 401/403 e erro de servidor não renovam a sessão.
- Sessão renovada e coleta confirmada são estados distintos. Cada base só
  recebe confirmação após ciclo de sucesso iniciado depois da renovação,
  com pelo menos uma rota processada e telemetria aceita pelo JM Routes. A
  confirmação perde validade após cinco minutos. Bases sem rotas, em dry-run
  ou com ciclo parcial não recebem confirmação verde.
- O runtime inicia o coletor operacional e o coletor de Dashboard Geral juntos,
  com a mesma sessão cifrada e refresh token coordenado. Se um coletor encerrar,
  o runtime encerra para o supervisor reiniciar ambos.

Em `PILOT_WRITE=true`, inicia somente o coletor do piloto e identifica esse modo
na tela. Recibos do piloto confirmam exclusivamente a coleta do piloto, após o
fechamento aceito pelo servidor; não são aceitos como confirmação operacional.
Em `DRY_RUN=true` com `PILOT_WRITE=false`, não inicia o Dashboard Geral e não
publica dados. Os dois coletores só são iniciados juntos no modo operacional.

## Publicação

Esta é uma implementação para validação em servidor. O teste real do Meli/Okta
e a atualização efetiva do ambiente de produção não são comprovados por testes
locais. O Meli pode exigir regras corporativas de rede/dispositivo que precisem
ser atendidas também pelo servidor. O fluxo deve ser validado com a conta real.

1. Confira se os valores observados acima continuam atuais antes do deploy.
   A proposta renova autenticação e preserva o piloto; a promoção para ingestão
   operacional é uma alteração separada e não deve ser feita incidentalmente.
2. Use `Dockerfile.mobile` e uma configuração baseada em
   `fly.mobile.example.toml`. Mantenha exatamente uma máquina com volume
   persistente. O login e os coletores devem compartilhar o mesmo volume e
   `WORKER_SESSION_KEY`. Uma nova aplicação Fly não compartilha automaticamente
   o volume de outra aplicação. Este serviço não envia sessão a workers em
   outros hosts ou notebooks.
3. Preserve os secrets existentes. Configure `MOBILE_ACCESS_KEY` (aleatória e exclusiva),
   `WORKER_SESSION_KEY` (32 bytes base64), `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `WORKER_EMAIL` e os meios de autenticação JMRoutes já usados pelo coletor.
   Para o piloto, preserve `MELI_PILOTO_INGEST_SECRET` sem imprimir seu valor.
   Não use `service_role`. Configure a origem HTTPS exata em
   `MOBILE_PUBLIC_ORIGIN`, `JMR_BASE_URL` e as bases autorizadas em `BASE_CODES`.
   Não envie secrets em mensagens nem os coloque no repositório.
4. Para teste sem escrita, use `DRY_RUN=true`, `PILOT_WRITE=false` e uma base.
   Para preservar a coleta isolada atual, mantenha `PILOT_WRITE=true`.
   Abra o endereço no Android ou iPhone,
   entre com a chave administrativa, toque em “Abrir login do Meli”, toque no
   campo da tela oficial, envie usuário/senha pela caixa de digitação e avance.
   Aprove o Okta no aplicativo e retorne à página. A sessão deve ser renovada.
5. Se houver uma solicitação separada para promover à operação, confirme usuário técnico e permissões; defina
   `PILOT_WRITE=false`, `DRY_RUN=false` e `WRITE_BASE_CODES` explicitamente. Desative coletores
   antigos sobrepostos antes de ativar a escrita. Valide rotas e data de
   atualização diretamente no Recebimento e no Dashboard Geral. O indicador
   de coleta da página confirma o pipeline operacional, não cada indicador
   ou módulo do dashboard.
6. Teste com notebook desligado, troca para o Okta e retorno, login incorreto,
   sessão vencida, falha de rede, reinício da máquina e duas tentativas
   simultâneas. Teste rolagem e teclado no Android real. Se a tela exigir um
   recurso não suportado pela interação remota, não considere homologado.

O serviço não reinicia workers de outros servidores. Se eles estiverem apenas
no notebook, a migração dos coletores para este runtime é parte necessária da
publicação. A URL ainda não existe antes desse provisionamento.

## Desenvolvimento

## Publicar pelo GitHub, inclusive pelo celular

O workflow `.github/workflows/jmroutes-mobile.yml` só executa por
`workflow_dispatch`. A opção padrão é `validar`. Para publicar, selecione
`publicar` e confirme o nome exato do app. O job valida testes/build e publica
exatamente o commit que foi testado, preservando piloto, banco, volume e
tamanho de máquina (1 CPU compartilhada / 1 GB). Habilita serviço HTTPS para
o iniciador no app atual. A exposição é protegida pela chave administrativa.

No GitHub, em Settings > Secrets and variables > Actions, configure:

- `FLY_API_TOKEN`: deploy token criado na página Tokens do app
  `jmroutes-meli-worker-esp16`, com expiração curta para a implantação inicial.
- `MOBILE_ACCESS_KEY`: chave aleatória exclusiva com no mínimo 32 caracteres.
  Guarde-a no seu gerenciador de senhas: será usada para entrar no iniciador.

Copie o deploy token diretamente do campo seguro da Fly para o secret do
GitHub. Não envie tokens ou chaves na conversa. O workflow transfere somente
a chave do iniciador para os secrets do app e preserva os demais secrets.
O deploy token não vai para o navegador nem para o container do worker.

Para aparecer no menu Actions e poder receber execução manual, o workflow
precisa existir na branch padrão do repositório. O campo `source_ref` identifica
a branch revisada `codex/iniciador-movel-workers`; o workflow fixa o SHA validado
para evitar publicar uma versão diferente se houver novo commit durante o job.

Ao concluir, o job verifica `/health` e que `/screen` e `/status` recusam acesso
anônimo. Login real e atualização do piloto exigem homologação no celular.

## Comandos locais

Dentro de `worker/meli`: `npm ci`, `npm run typecheck`, `npm test`,
`npm run build`. O entrypoint compilado é `dist/mobile/main.js`.
Para testes locais, `MOBILE_PUBLIC_ORIGIN` aceita HTTP somente em
`localhost`/`127.0.0.1`; produção exige HTTPS. O acesso ao serviço deve continuar
restrito aos responsáveis por autenticar a conta corporativa.
