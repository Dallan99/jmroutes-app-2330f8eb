# Corrigir o tempo esgotado na gravação dos lotes Meli (piloto)

## Problema confirmado
Os lotes de rotas e pacotes vindos do worker são recusados por "statement timeout" (limite de 2 min no banco). Conferido no banco de homologação `zfmwojloamwggahjxlyt`:
- A tabela de pacotes do piloto já tem cerca de 456 mil linhas (435 MB) e o staging tem 164 MB, porque cada ciclo regrava o conteúdo bruto completo de cada pacote, mesmo quando nada mudou.
- O Dashboard e o Monitoramento consultam a tabela de ciclos (13 mil linhas) com ordenações sem índice adequado, levando de 1 a 7 s por consulta, milhares de vezes. Isso concorre com a gravação dos lotes.
- Os índices usados pela própria gravação já existem; o gargalo é volume regravado e concorrência, não índice ausente.

## O que será feito (uma migration, só em `zfmwojloamwggahjxlyt`)
1. Na função de ingestão, só atualizar rota/pacote quando algo mudou de fato (status, totais, motorista, placa ou conteúdo). Pacotes iguais deixam de ser regravados.
2. Trocar as três contagens totais do fim de cada lote (páginas, rotas, pacotes do ciclo) por incremento a partir do que o próprio lote gravou.
3. Adicionar índices para as consultas de leitura de ciclos: (base, status, fim do ciclo) e (início do ciclo).
4. Manter todas as regras atuais: só service role, só DRY_RUN=true, ESP18 recusada, estação confirmada, gravação somente nas tabelas `meli_piloto_*`, sem tocar em recebimento/triagem/devolução.

## O que não muda
Worker, DRY_RUN, secrets, login, RLS, pagamentos, layout do Dashboard. Nada é apagado. Nada é publicado.

## Riscos
- Contador de pacotes recebidos passa a ser incremental: pode diferir em ±1–2 do recálculo atual em ciclos repetidos; um teste compara os dois.
- Os índices novos são criados uma vez e são pequenos.

## Validação
Rodar a função em transação desfeita com um lote real do staging e medir o tempo; confirmar contagens; acompanhar os logs do ingest após o próximo ciclo do worker.
