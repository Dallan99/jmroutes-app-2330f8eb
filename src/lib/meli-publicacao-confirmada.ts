type Publicar = (data: string) => Promise<{ data: unknown; error: unknown }>;

/** A ingestão já pode estar confirmada; repetir deve manter o mesmo ciclo. */
export async function confirmarPublicacaoRecebimento(datas: string[], publicar: Publicar) {
  const recebimento: unknown[] = [];
  for (const data of [...new Set(datas)]) {
    const resultado = await publicar(data);
    if (resultado.error) return { ok: false as const, recebimento };
    recebimento.push(resultado.data);
  }
  return { ok: true as const, recebimento };
}
