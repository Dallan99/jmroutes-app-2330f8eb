<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Pagamentos de motoristas: regras de cálculo ficam puras em src/lib/pagamentos-domain.ts (testáveis); tarifas e tipo de veículo vêm de tabelas, nunca do código — valores mudam por base/região/vigência.

- Módulos cujas tabelas ainda não existem no banco acessam o Supabase via `clienteDeModulo` (src/lib/modulo-em-implantacao.ts), que bloqueia tabelas/RPCs não implantadas; os tipos do banco refletem só o que existe. Por quê: implantação por etapas sem descrever o banco de forma fictícia. Ao aplicar uma parte, atualize TABELAS_IMPLANTADAS/RPCS_IMPLANTADAS.

- Piloto Meli: o worker grava só nas tabelas `meli_piloto_*`, passando por `/api/public/meli/piloto/*` (assinatura HMAC) e por RPCs que só o service_role executa, e apenas com DRY_RUN=true. Por quê: validar a coleta sem tocar nas tabelas operacionais. A normalização do detalhe bruto fica no servidor (`meli-normalize`).
