# Recuperação em 17/10/2026

- Aplicativo: `jmroutes-meli-worker-esp16`, região `gru`.
- Máquina substituta: `82d1e51a072148` (`jmroutes-mobile-recuperado`).
- Volume restaurado: `vol_4oj22wy6dx27nxpr`, nome `meli_rec_20261017`, montado em `/data`, snapshots automáticos habilitados.
- Snapshot de origem: `vs_vJBxyzneL9As2L4QOGPLzPJ`, cerca de 21 horas antes da recuperação.
- Máquina antiga `d8946d0f7360d8` e volume `vol_458jmm22om03xpx4` preservados; host com falha de hardware.
- Imagem recuperada: `registry.fly.io/jmroutes-meli-worker-esp16@sha256:cf980912717a40171e7e0d11dbeaed763c9197009531db18438329e998bc0904`.
- Fonte validada: `116b7d4a1099dd1d26002b573bb115f52b0c2be0`.
- Comando explícito: `node dist/mobile/main.js`; reinício automático `always`.
- CPU compartilhada 1 vCPU, RAM 1024 MB; portas públicas 80/443, serviço 8080 e /health.
- Modo preservado: DRY_RUN=true e PILOT_WRITE=true. Coleta escreve apenas no piloto, não no dashboard operacional.
- Segredos existentes do aplicativo reutilizados. Nenhuma credencial registrada neste documento.
- URL: https://jmroutes-meli-worker-esp16.fly.dev/

## Cuidados no próximo deploy

A configuração histórica fly.mobile.example.toml ainda nomeia o volume anterior `meli_session`. Antes de deploys futuros, reconciliar explicitamente com a máquina e o volume substitutos. Não executar deploy global que tente atualizar o host inacessível ou crie volumes vazios. Não apagar o volume antigo sem confirmação.

A restauração não prolonga a validade do login Meli. A sessão restaurada foi rejeitada como expirada/redirecionada; o operador precisa concluir login oficial e Okta pelo iniciador. Só considerar a integração retomada após observar ciclo novo por base. Não confundir confirmação do piloto com ingestão operacional.
