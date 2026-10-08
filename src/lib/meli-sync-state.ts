export function avaliarSincronizacao(
  ultimoSucesso: string | null,
  ultimoHeartbeat: string | null,
  loginConfirmado: boolean,
  agora: number,
) {
  const heartbeatRecente = !!ultimoHeartbeat && Number.isFinite(Date.parse(ultimoHeartbeat))
    && agora - Date.parse(ultimoHeartbeat) <= 10 * 60_000;
  if (heartbeatRecente && loginConfirmado) return { estado: 'autenticacao_necessaria', acao: 'manual' };
  if (!heartbeatRecente) return { estado: 'worker_sem_sinal', acao: 'verificar_worker' };
  if (!ultimoSucesso || !Number.isFinite(Date.parse(ultimoSucesso)) || agora-Date.parse(ultimoSucesso)>25*60_000)
    return { estado: 'sem_atualizacao', acao: 'recuperacao_automatica' };
  return { estado: 'atualizado', acao: 'automatica' };
}
