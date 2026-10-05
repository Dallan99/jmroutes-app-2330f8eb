import { Card } from "@/components/ui/card";
import { MENSAGEM_MODULO_EM_IMPLANTACAO } from "@/lib/modulo-em-implantacao";

export function ModuloEmImplantacao({ titulo }: { titulo: string }) {
  return (
    <div className="p-4 md:p-6">
      <Card className="mx-auto max-w-xl p-6 text-center space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-warning">Módulo em implantação</p>
        <h1 className="text-xl font-semibold">{titulo}</h1>
        <p className="text-sm text-muted-foreground">{MENSAGEM_MODULO_EM_IMPLANTACAO}</p>
      </Card>
    </div>
  );
}
