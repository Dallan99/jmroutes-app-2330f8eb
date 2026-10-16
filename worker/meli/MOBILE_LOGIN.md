# Iniciador móvel do Meli

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

## Publicação

Esta é uma implementação para validação em servidor. O teste real do Meli/Okta
e a atualização efetiva do ambiente de produção não são comprovados por testes
locais. O Meli pode exigir regras corporativas de rede/dispositivo que precisem
ser atendidas também pelo servidor. O fluxo deve ser validado com a conta real.

1. Confirme o aplicativo Fly que executa os coletores atuais e o banco destino.
   O `fly.toml` legado aponta a um piloto com `DRY_RUN=true` e projeto antigo;
   não reutilize esses valores sem conferir a implantação real.
2. Use `Dockerfile.mobile` e uma configuração baseada em
   `fly.mobile.example.toml`. Mantenha exatamente uma máquina com volume
   persistente. O login e os coletores devem compartilhar o mesmo volume e
   `WORKER_SESSION_KEY`. Uma nova aplicação Fly não compartilha automaticamente
   o volume de outra aplicação. Este serviço não envia sessão a workers em
   outros hosts ou notebooks.
3. Configure em secrets/ambiente: `MOBILE_ACCESS_KEY` (aleatória e exclusiva),
   `WORKER_SESSION_KEY` (32 bytes base64), `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `WORKER_EMAIL` e os meios de autenticação JMRoutes já usados pelo coletor.
   Não use `service_role`. Configure a origem HTTPS exata em
   `MOBILE_PUBLIC_ORIGIN`, `JMR_BASE_URL` e as bases autorizadas em `BASE_CODES`.
   Não envie secrets em mensagens nem os coloque no repositório.
4. Valide primeiro `DRY_RUN=true` e uma base. Abra o endereço no Android,
   entre com a chave administrativa, toque em “Abrir login do Meli”, toque no
   campo da tela oficial, envie usuário/senha pela caixa de digitação e avance.
   Aprove o Okta no aplicativo e retorne à página. A sessão deve ser renovada.
5. Para produção, confirme usuário técnico e permissões; defina
   `DRY_RUN=false` e `WRITE_BASE_CODES` explicitamente. Desative coletores
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

Dentro de `worker/meli`: `npm ci`, `npm run typecheck`, `npm test`,
`npm run build`. O entrypoint compilado é `dist/mobile/main.js`.
Para testes locais, `MOBILE_PUBLIC_ORIGIN` aceita HTTP somente em
`localhost`/`127.0.0.1`; produção exige HTTPS. O acesso ao serviço deve continuar
restrito aos responsáveis por autenticar a conta corporativa.
