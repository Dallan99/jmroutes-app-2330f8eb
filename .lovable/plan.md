# Diagnóstico — Painel Operacional com dados antigos (16/09/2026)

## CAUSA EXATA
A sessão do coletor no portal do Mercado Livre (AdminML) expirou e passou a ser redirecionada para a tela de login. Desde então o coletor continua rodando a cada ~5 minutos, mas não consegue ler nenhuma rota, então não envia snapshot nenhum. O painel segue mostrando o último dado válido e o contador de "desatualizado há X min" cresce.

Não é problema de banco, de RPC nem da proteção contra snapshot vazio: a proteção só recusa gravação quando um snapshot zerado chega, e neste caso nada chegou. Nenhuma gravação foi rejeitada, e `updated_at` sempre acompanhou `coletado_em` com ~12 segundos de diferença (normal).

## ÚLTIMA EXECUÇÃO DO WORKER
- Última execução (tentativa): 17/09/2026 01:39 UTC — continua rodando a cada ~5 min.
- Última execução bem-sucedida: 16/09/2026 20:42 UTC.
- Entre 18:28 e 01:39 houve 66 execuções, todas com status "aguardando autenticação" / sessão ausente.

## ÚLTIMA GRAVAÇÃO POR BASE (UTC)
- ESP15 20:45:12 | SSP20 20:45:14 | SSP3 20:45:05 | SSP38 20:45:08
- ESP16 20:43:26 | ESP17 20:43:21 | ESP18 20:43:39 | SSC2 20:43:59
- SSP15 20:43:30 | SSP17 20:43:34 | SSP23 20:43:53 | SSP45 20:43:45
- SSP5 20:43:16 | SSP6 20:43:43
- SSP37 15:51:58 (já estava parada antes)

Todas as bases pararam praticamente juntas, na mesma janela de 20:43–20:45 — confirmando causa única e comum (a sessão), não falha por base.

## ERRO ENCONTRADO
`sessão AdminML indisponível: sessao_expirada_redirecionada` (status `aguardando_autenticacao`, sessão `ausente`), repetido em todas as execuções desde 18:28 UTC. Antes disso houve sinais de degradação: 44 execuções com limite de requisições (rate limit), 3 com sessão expirada e 2 com o circuito pausado — ou seja, a sessão vinha sendo derrubada por excesso de chamadas antes de cair de vez.

## CORREÇÃO MÍNIMA RECOMENDADA
1. Refazer o login do coletor no portal Meli na máquina/servidor do coletor (renovar a sessão salva). Isso sozinho volta a alimentar o painel.
2. Depois de reconectar, reduzir o ritmo de coleta (menos bases em paralelo / intervalo maior) para evitar o limite de requisições que derrubou a sessão.
3. Melhoria opcional de visibilidade: mostrar no Painel Operacional um aviso de "coleta aguardando reconexão" quando a última execução estiver em `aguardando_autenticacao`, para não parecer que os números são atuais.

Nada foi alterado: sem mudanças em código, banco, RPC, coletor, painéis, menu ou publicação.
