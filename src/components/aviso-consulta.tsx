import { AlertTriangle } from "lucide-react";
import { mensagemDeErroConsulta } from "@/lib/consulta-com-timeout";

/** Aviso discreto quando a última atualização falhou (os dados anteriores continuam na tela). */
export function AvisoConsulta({ erro, temDados }: { erro: unknown; temDados?: boolean }) {
  if (!erro) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        {mensagemDeErroConsulta(erro)}
        {temDados ? " Mostrando os últimos dados carregados." : ""}
      </span>
    </div>
  );
}
