# Retenção de dados — plano "banco enxuto"

Documento de decisão. Nenhum dado foi apagado e nenhuma regra foi alterada.

## Por que isto é necessário

O banco da homologação (`ieqvzndvkzozqvseubuc`) está no plano gratuito, cujo limite de disco é **500 MB**.
Ele está em **1.558 MB** e por isso o Supabase o colocou em **modo só leitura**: ninguém consegue entrar
(o login precisa gravar um registro) e o coletor não consegue gravar rotas.

Medição de 29/09/2026:

| Conteúdo | Tamanho | Linhas |
|---|---|---|
| `escalas` (escala importada por veículo) | 764 MB | 820.471 |
| `meli_pacotes` (pacote individual do Meli) | 533 MB | 837.483 |
| `meli_devolucoes_eventos` | 87 MB | 271.331 |
| `meli_rotas_payload` (cru de importação) | 71 MB | 8.814 |
| `meli_importacoes` (log de importação) | 56 MB | 312.252 |
| **Soma dos dois maiores** | **1.297 MB** | |
| Demais tabelas juntas | 260 MB | |

Crescimento medido nos últimos 30 dias: **459.141 escalas + 447.966 pacotes ≈ 24 MB por dia**.

## A conta que precisa ser decidida

| Cenário | Tamanho previsto | Cabe no gratuito (500 MB)? |
|---|---|---|
| Guardar detalhe individual por **30 dias** | ~970 MB | **Não** (quase o dobro) |
| Guardar detalhe individual por **7 dias** + resumo diário | ~420 MB | Apertado, mas sim |
| **7 dias** + resumo diário + limpar logs internos | **~300 MB** | Sim, com folga |

Conclusão: **detalhe individual por 30 dias e plano gratuito não cabem juntos.** O detalhe mais antigo
precisa sair do banco ativo e virar arquivo de consulta (exportação mensal), não ficar guardado para sempre.

## O que o painel já usa (não precisa do detalhe)

- Painel Operacional e Gerencial: `meli_monitoramento_snapshots` (1 resumo por base por dia, 344 kB) e `meli_rotas` (8 MB).
- Detalhamento de pacote individual: `meli_pacotes` — usado só ao abrir uma rota.
- Escala importada: `escalas` — usada para o dia corrente e para conferência recente.

Ou seja, apagar o detalhe antigo **não** zera nenhum painel: os números históricos vêm dos resumos.

## Desenho proposto (aditivo, reversível)

1. **Resumo diário de escala** (`escala_resumo_diario_base`): 1 linha por base por dia — veículos, motoristas,
   rotas, pacotes, triadas, recebidas. 17 bases × 365 dias = ~6.200 linhas/ano (menos de 2 MB).
2. **Rotina de manutenção** (`meli_manutencao_retencao`): consolida o resumo, exporta antes de apagar, e apaga em lotes:
   - `meli_pacotes` e `escalas` com mais de **7 dias** (mantendo as escalas que têm leitura de expedição registrada);
   - `meli_rotas_payload` com mais de 7 dias;
   - `meli_importacoes` com mais de 90 dias;
   - `meli_worker_execucoes` com mais de 30 dias;
   - `meli_devolucoes_eventos` com mais de 180 dias (trilha de auditoria mais longa).
3. **Agendamento** com o `pg_cron` já instalado, todo dia às 01:30.
4. **Arquivo de consulta**: antes da primeira limpeza, exportar o histórico (escalas e pacotes) em CSV para
   servir de consulta até onde a operação precisar — o banco ativo fica pequeno, a memória fica no arquivo.

## O que impede executar agora

O banco está travado em só leitura e **nada que escreve pode rodar** — nem o apagar, nem criar a tabela de
resumo, nem agendar. E o travamento só sai quando o banco voltar abaixo de 500 MB ou o plano mudar.
Como apagar também é escrita, é preciso uma destas três saídas para destravar:

1. **Suporte do Supabase** libera a escrita temporariamente (gratuito, demorado).
2. **Subir para o Pro por um ciclo** (~US$ 25), aplicar a limpeza + `VACUUM FULL`, confirmar abaixo de 500 MB
   e **voltar para o gratuito** — o banco fica enxuto e o custo é único.
3. **Projeto novo no gratuito** (banco vazio = aceita escrita): reproduzir as 90 migrations, recriar os 23
   usuários (cada um precisa de redefinição de senha) e apontar app, coletor e extensão para ele. O atual
   fica congelado como arquivo de consulta.

SQL pronto em `supabase/propostas/20260929120000_retencao_enxuta.sql` (não aplicado).
