# Migração para um banco novo (plano gratuito)

Escolha registrada: **continuar no plano gratuito com um banco novo**, porque o banco atual da
homologação (`ieqvzndvkzozqvseubuc`) está travado em modo só leitura com 1.558 MB sobre um limite de
500 MB — e apagar também é escrita, então não dá para se limpar por dentro.

Nada foi alterado até aqui. Os arquivos abaixo estão prontos e **ainda não foram executados**.

## O que já está preparado

| Arquivo | O que faz |
|---|---|
| `supabase/replay/01_estrutura.sql` … `07_estrutura.sql` | Recriam toda a estrutura do sistema (as 90 etapas de estrutura, na ordem, sem nada a mais) |
| `supabase/replay/08_seeds_cadastros.sql` | Recria as **17 bases** (com os mesmos identificadores de hoje), as **20 unidades do Meli** e os **10 códigos de falha** |
| `supabase/replay/09_seeds_acessos.sql` | Recria **perfil, papel e base das 23 pessoas**, pareando por e-mail |
| `supabase/propostas/20260929120000_retencao_enxuta.sql` | Resumo diário de escala + rotina de retenção + agendamento (para o banco novo já nascer enxuto) |
| `docs/retencao-dados.md` | A medição de espaço que motivou a decisão |

## Ordem de execução

1. **Você cria o projeto novo** no painel do Supabase: plano gratuito, mesma região
   (`ca-central-1`), nome sugerido `jmroutes-homolog-02`. Guarde a URL do projeto e a chave publicável.
2. **Você conecta o app ao banco novo** (integração Supabase no editor do Lovable). É o passo que
   realmente muda o destino das telas — enquanto ele não acontecer, tudo continua no banco de hoje.
3. **Eu rodo os 7 lotes de estrutura**, depois o seed de cadastros (17 bases + unidades + códigos).
4. **Você recria os 23 acessos**: em *Authentication → Users*, use *Add user* (e-mail + senha
   provisória) ou *Invite user* (a pessoa define a própria senha). A lista exata está em
   `09_seeds_acessos.sql`.
5. **Eu rodo o seed de acessos** (papel de cada um + base de cada um). Ele é à prova de repetição:
   quem ainda não existir fica de fora e entra numa nova rodada, sem duplicar ninguém.
6. **Histórico que queremos levar** (exportação do banco atual, que ainda aceita leitura):
   rotas (`meli_rotas`, 8 MB), monitoramento diário (`meli_monitoramento_snapshots`), devoluções
   (`meli_devolucoes`, 10 MB) e desempenho/SLA. Isso mantém os painéis com histórico no banco novo.
   O detalhe de pacote e a escala antiga **não** entram — ficam congelados no banco atual como arquivo.
7. **Eu aplico a retenção enxuta** desde o primeiro dia e agendo a rotina (o `pg_cron` já está
   disponível nos projetos do Supabase).
8. **Coletor e extensão**: no notebook do coletor, atualizar o arquivo de configuração
   (`.env.local`) com a URL e a chave do banco novo, e publicar a função do fechamento do painel
   (`enviar-dashboard-geral`) no projeto novo.
9. **Observação por 7 dias**: o banco atual continua ligado e legível. Se algo não bater, é só
   reconectar o app a ele — ele não foi alterado.

## O que muda para a operação

- Todo mundo precisa **definir senha de novo** (as senhas não podem ser copiadas de um banco para o
  outro). São 23 pessoas.
- O painel volta a mostrar histórico **depois** da importação do item 6; o que não for importado
  (detalhe de pacote e escala antiga) fica consultável só no banco antigo.
- O coletor para de gravar enquanto a chave nova não estiver no notebook — melhor fazer isso no
  mesmo dia do passo 8.

## Riscos e como se protege

| Risco | Proteção |
|---|---|
| Alguém fica sem acesso | O seed de acessos lista quem ainda não existe; a conferência no fim do arquivo mostra papel e perfil de cada um |
| Perder histórico | Exportar antes (item 6); o banco antigo não é apagado nem pausado antes dos 7 dias |
| Coletor continuar escrevendo no banco velho | Conferir no painel do projeto novo se as execuções do coletor aparecem; o banco velho não recebe escrita nova |
| Banco novo encher como o antigo | A retenção enxuta já nasce aplicada: detalhe por ~7 dias + resumo diário + logs curtos |

## Como voltar atrás

O banco atual **não recebe nenhuma alteração** nesta migração. Enquanto o app estiver apontado para
ele, é possível desistir a qualquer momento; depois de apontar para o novo, basta reconectar ao
antigo (ele continua com todos os dados de hoje).
