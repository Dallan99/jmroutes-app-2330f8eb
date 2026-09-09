# Diagnóstico: menus restritos desaparecem depois que o perfil carrega

Somente investigação. Nada foi alterado em código, banco, RLS, sidebar, PWA, workers, rotas ou permissões.

## 1) Como `meuPerfil` consulta os papéis

`src/lib/recebimento.functions.ts:338-368`

- Função de servidor com `requireSupabaseAuth`; usa o cliente Supabase que age como o próprio usuário (RLS aplicada).
- Faz três leituras em paralelo: `profiles` (por `id = userId`), `user_roles` (`select role where user_id = userId`) e `user_bases`.
- Monta `roles` a partir de `user_roles` e define `acessoTotal` para `admin`/`gerente`.
- Ponto crítico: as três leituras descartam o campo de erro (`const [{ data: profile }, { data: roles }, ...]`). Qualquer falha de leitura vira, silenciosamente, lista de papéis vazia — e a função ainda responde com sucesso.

## 2) O usuário autenticado está sendo resolvido corretamente?

Sim, o caminho está correto e completo:

- `src/integrations/supabase/auth-middleware.ts` exige cabeçalho `Bearer`, valida o token via `getClaims` e usa `claims.sub` como `userId`.
- `src/integrations/supabase/auth-attacher.ts` anexa o token em cada chamada e renova quando falta menos de 60s para expirar.
- `src/start.ts` registra esse anexador globalmente.
- Não há uso de cliente administrativo em `meuPerfil`, portanto o `userId` vem sempre do token do usuário.

## 3) Evidência de retorno vazio, erro ou RLS

Consultei o banco conectado (JM Routes) e não encontrei bloqueio estrutural:

- `user_roles` tem política de leitura própria: `SELECT ... using (auth.uid() = user_id)` para `authenticated`, além da política de supervisores/gerentes/admins.
- Permissões de tabela presentes para `anon`, `authenticated` e `service_role` em `user_roles`, `profiles` e `user_bases`.
- Dados existem: 22 registros em `user_roles`; todos os usuários humanos têm exatamente 1 papel. O último login (09/09, `dallan.zanini@jmdistribuicao.com.br`) tem papel `admin` e perfil criado.
- Único registro sem papel: a conta de motorista `pastor@motoristas.jmroutes.local`.
- Não havia erros de execução nem chamadas de rede registradas no snapshot do preview, então não há prova de erro em tempo real — apenas a certeza de que, se houver erro, ele é engolido (item 1).

## 4) Causa mais provável

O menu começa **permissivo**: em `src/components/app-shell.tsx:186-191`, o filtro é `!rolesCarregadas || !item.roles || ...`. Enquanto o perfil está carregando, **todos** os itens aparecem; quando a resposta chega, os itens restritos são filtrados pelos papéis recebidos. Ou seja, "sumir depois de carregar" é sempre o mesmo evento: a resposta trouxe uma lista de papéis que não contém o papel exigido.

Duas explicações compatíveis com o código e com os dados, em ordem de probabilidade:

1. **Falha silenciosa de leitura de papéis** (mais provável quando o usuário é admin e ainda perde os menus): como os erros das três consultas são ignorados, uma falha momentânea (erro do PostgREST, tempo esgotado, sessão trocada no meio da chamada) resulta em `roles: []` com resposta de sucesso. O menu então esconde tudo que é restrito, sem qualquer mensagem. Sinal distintivo: o nome do usuário no topo aparece como "—" e o papel exibido cai para "Operador".
2. **Comportamento esperado para papel operador**: se a conta em uso tem papel `operador` (há 6 no banco) ou é conta de motorista sem papel, os itens de gestão/administração devem realmente desaparecer. O que confunde é o flash inicial mostrando o menu completo antes da filtragem.

Para separar as duas hipóteses sem mudar nada: observar, logo após o carregamento, o nome e o papel exibidos no canto superior direito. Nome preenchido + "Operador" indica o caso 2 (permissão real). Nome "—" com conta que deveria ser administradora indica o caso 1 (leitura falhou e foi engolida).

## Correções possíveis (não executadas, aguardando autorização)

- Propagar erro nas três leituras de `meuPerfil` para a interface distinguir "sem papel" de "falha ao carregar".
- Inverter o padrão do menu: esconder itens restritos até os papéis carregarem, evitando o flash e o efeito de "sumiço".
