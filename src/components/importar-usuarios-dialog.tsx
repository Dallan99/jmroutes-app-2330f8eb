import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Upload, FileDown, AlertTriangle } from "lucide-react";
import {
  importarUsuarios,
  type ImportarUsuarioResultado,
} from "@/lib/usuarios.functions";

type Role = "admin" | "gerente" | "supervisor" | "operador";

type Linha = {
  linha: number;
  nome: string;
  email: string;
  role: Role;
  base_codigo: string;
  matricula: string;
  senha: string;
  erro?: string;
};

const HEADER = ["nome", "email", "role", "base_codigo", "matricula", "senha"] as const;

// Aliases de cabeçalho aceitos no CSV (normalizados: sem acento, lowercase).
const HEADER_ALIASES: Record<string, (typeof HEADER)[number]> = {
  nome: "nome",
  name: "nome",
  email: "email",
  "e-mail": "email",
  role: "role",
  perfil: "role",
  papel: "role",
  base_codigo: "base_codigo",
  base: "base_codigo",
  "codigo base": "base_codigo",
  matricula: "matricula",
  senha: "senha",
  senhas: "senha",
  password: "senha",
};

// Traduz valores PT do "Perfil" para roles do sistema.
const ROLE_ALIASES: Record<string, Role> = {
  admin: "admin",
  administrador: "admin",
  administradora: "admin",
  gerente: "gerente",
  supervisor: "supervisor",
  supervisora: "supervisor",
  operador: "operador",
  operadora: "operador",
};

const BASES_VALIDAS = [
  "SSP3", "SSP38", "ESP15", "SSP5", "SSP20", "ESP17", "ESP16", "SSP17",
  "ESP18", "SSP6", "SSP45", "SSP15", "SSP37", "SSP23", "SSC2", "SSP4", "SSP7",
] as const;
const BASE_ALIASES: Record<string, (typeof BASES_VALIDAS)[number]> = {
  ESP15: "ESP15",
  ESP16: "ESP16",
  ESP17: "ESP17",
  ESP18: "ESP18",
  SSP3: "SSP3",
  SSP38: "SSP38",
  SSP5: "SSP5",
  SSP20: "SSP20",
  SSP17: "SSP17",
  SSP6: "SSP6",
  SSP45: "SSP45",
  SSP15: "SSP15",
  SSP37: "SSP37",
  SSP23: "SSP23",
  SSC2: "SSC2",
  SSP4: "SSP4",
  SSP7: "SSP7",
  IBIUNA: "ESP15",
  "BASE DE IBIUNA": "ESP15",
  GUARUJA: "ESP16",
  GAURUJA: "ESP16",
  "BASE DE GUARUJA": "ESP16",
  "EMBU GUACU": "ESP17",
  "BASE DE EMBU GUACU": "ESP17",
  "SAO LOURENCO": "ESP17",
  "FRANCO DA ROCHA": "ESP18",
  "BASE DE FRANCO DA ROCHA": "ESP18",
};

function normalizarTexto(entrada: string): string {
  return entrada
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function limparValor(entrada: string): string {
  const v = entrada.trim();
  if (!v || v === "—" || v === "-" || v === "–") return "";
  return v;
}

function normalizarBase(entrada: string): string {
  const bruto = limparValor(entrada);
  if (!bruto) return "";
  const norm = normalizarTexto(bruto);
  const sigla = norm.match(/(?:ESP|SSP|SSC)\s*\d+/);
  if (sigla) return sigla[0].replace(/\s+/g, "");
  return BASE_ALIASES[norm] ?? norm;
}

function normalizarRole(entrada: string): Role | "" {
  const v = limparValor(entrada).toLowerCase();
  if (!v) return "";
  return (ROLE_ALIASES[v] ?? v) as Role;
}

function parseCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let dentroAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroAspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') {
        dentroAspas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === "," || c === ";") {
      linha.push(campo);
      campo = "";
    } else if (c === "\n") {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else if (c !== "\r") {
      campo += c;
    }
  }
  if (campo.length > 0 || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas.filter((l) => l.some((c) => c.trim().length > 0));
}

const SENHA_PADRAO = "JM@transportes";

function gerarSenha(): string {
  return SENHA_PADRAO;
}

function validar(l: Omit<Linha, "linha" | "erro">): string | undefined {
  if (!l.nome || l.nome.length < 2) return "Nome inválido.";
  if (!l.email.includes("@")) return "Email inválido.";
  if (!l.email.toLowerCase().endsWith("@jmdistribuicao.com.br"))
    return "Domínio precisa ser @jmdistribuicao.com.br.";
  if (!["admin", "gerente", "supervisor", "operador"].includes(l.role))
    return "Role deve ser admin|gerente|supervisor|operador.";
  if (l.role === "operador" && !l.base_codigo) return "Operador exige base_codigo.";
  if (l.base_codigo && !BASES_VALIDAS.includes(l.base_codigo as (typeof BASES_VALIDAS)[number]))
    return `Base inválida: use um dos códigos cadastrados (${BASES_VALIDAS.join(", ")}).`;
  if (l.senha.length < 8) return "Senha muito curta (mínimo 8).";
  return undefined;
}

export function ImportarUsuariosDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<ImportarUsuarioResultado[] | null>(null);
  const importar = useServerFn(importarUsuarios);

  const linhas = useMemo<Linha[]>(() => {
    if (!texto.trim()) return [];
    const rows = parseCsv(texto);
    if (rows.length === 0) return [];
    const first = rows[0].map((c) =>
      c
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, ""),
    );
    // header detectado se ao menos uma célula bate com um alias conhecido
    const isHeader = first.some((c) => c in HEADER_ALIASES);
    // Mapeia cada coluna HEADER para o índice correspondente no CSV
    const idxs = HEADER.map((h) => {
      if (isHeader) {
        const i = first.findIndex((c) => HEADER_ALIASES[c] === h);
        return i;
      }
      return HEADER.indexOf(h);
    });
    const dataRows = (isHeader ? rows.slice(1) : rows).filter(
      (r) => !(r[0] ?? "").trim().startsWith("#"),
    );
    return dataRows.map((cols, i) => {
      const get = (idx: number) => (idx >= 0 ? (cols[idx] ?? "").trim() : "");
      const roleNorm = normalizarRole(get(idxs[2]));
      const item: Omit<Linha, "linha" | "erro"> = {
        nome: limparValor(get(idxs[0])),
        email: limparValor(get(idxs[1])).toLowerCase(),
        role: (roleNorm || "operador") as Role,
        base_codigo: normalizarBase(get(idxs[3])),
        matricula: limparValor(get(idxs[4])),
        senha: limparValor(get(idxs[5])) || gerarSenha(),
      };
      return { linha: i + (isHeader ? 2 : 1), ...item, erro: validar(item) };
    });
  }, [texto]);

  const erros = linhas.filter((l) => l.erro).length;
  const validos = linhas.length - erros;

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = linhas
        .filter((l) => !l.erro)
        .map((l) => ({
          nome: l.nome,
          email: l.email,
          role: l.role,
          base_codigo: l.base_codigo || null,
          matricula: l.matricula || null,
          senha: l.senha,
        }));
      return importar({ data: { usuarios: payload } });
    },
    onSuccess: (res) => {
      setResultados(res);
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      const criados = res.filter((r) => r.status === "criado").length;
      toast.success(`${criados} usuário(s) criado(s).`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function baixarModelo() {
    const csv =
      HEADER.join(",") +
      "\n" +
      `# base_codigo aceita: ${BASES_VALIDAS.join("/")}\n` +
      "João Silva,joao.silva@jmdistribuicao.com.br,operador,ESP15,12345,\n" +
      "Maria Souza,maria.souza@jmdistribuicao.com.br,supervisor,Base de Guarujá,,\n" +
      "Pedro Lima,pedro.lima@jmdistribuicao.com.br,operador,São Lourenço ESP17,54321,\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-usuarios.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function baixarResultado() {
    if (!resultados) return;
    const linhasCsv = [
      "email,status,senha_temporaria,mensagem",
      ...resultados.map(
        (r) =>
          `${r.email},${r.status},${r.senha_temporaria ?? ""},"${(r.mensagem ?? "").replace(/"/g, '""')}"`,
      ),
    ];
    const blob = new Blob([linhasCsv.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resultado-importacao.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setTexto("");
          setResultados(null);
        }
      }}
    >
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="w-4 h-4 mr-2" /> Importar CSV
      </Button>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importar usuários (CSV)</DialogTitle>
          <DialogDescription>
            Colunas: <code>nome,email,role,base_codigo,matricula,senha</code>. Se a senha ficar em branco,
            uma temporária será gerada. Emails devem ser @jmdistribuicao.com.br.
          </DialogDescription>
        </DialogHeader>

        {!resultados && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={baixarModelo}>
                <FileDown className="w-4 h-4 mr-2" /> Baixar modelo
              </Button>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  f.text().then(setTexto);
                }}
                className="text-sm"
              />
            </div>
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Cole aqui o CSV..."
              className="min-h-40 font-mono text-xs"
            />
            {linhas.length > 0 && (
              <>
                <div className="text-sm flex items-center gap-3">
                  <Badge variant="secondary">{linhas.length} linha(s)</Badge>
                  <Badge className="bg-emerald-600">{validos} válida(s)</Badge>
                  {erros > 0 && (
                    <Badge variant="destructive">
                      <AlertTriangle className="w-3 h-3 mr-1" /> {erros} com erro
                    </Badge>
                  )}
                </div>
                <div className="max-h-64 overflow-auto border rounded">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Base</TableHead>
                        <TableHead>Matrícula</TableHead>
                        <TableHead>Senha</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linhas.map((l) => (
                        <TableRow key={l.linha}>
                          <TableCell>{l.linha}</TableCell>
                          <TableCell>{l.nome}</TableCell>
                          <TableCell className="text-xs">{l.email}</TableCell>
                          <TableCell>{l.role}</TableCell>
                          <TableCell>{l.base_codigo}</TableCell>
                          <TableCell>{l.matricula}</TableCell>
                          <TableCell className="text-xs font-mono">{l.senha}</TableCell>
                          <TableCell>
                            {l.erro ? (
                              <span className="text-destructive text-xs">{l.erro}</span>
                            ) : (
                              <span className="text-emerald-600 text-xs">OK</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        )}

        {resultados && (
          <div className="space-y-3">
            <div className="text-sm flex items-center gap-3">
              <Badge className="bg-emerald-600">
                {resultados.filter((r) => r.status === "criado").length} criados
              </Badge>
              <Badge variant="secondary">
                {resultados.filter((r) => r.status === "ja_existia").length} já existiam
              </Badge>
              <Badge variant="destructive">
                {resultados.filter((r) => r.status === "erro").length} com erro
              </Badge>
            </div>
            <div className="rounded border bg-yellow-50 text-yellow-900 p-3 text-xs">
              <strong>Importante:</strong> anote as senhas temporárias abaixo — elas não serão
              exibidas novamente. Use "Baixar resultado" para salvar o arquivo.
            </div>
            <div className="max-h-72 overflow-auto border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Senha temporária</TableHead>
                    <TableHead>Mensagem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultados.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{r.email}</TableCell>
                      <TableCell>
                        {r.status === "criado" && (
                          <Badge className="bg-emerald-600">criado</Badge>
                        )}
                        {r.status === "ja_existia" && <Badge variant="secondary">já existia</Badge>}
                        {r.status === "erro" && <Badge variant="destructive">erro</Badge>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.senha_temporaria ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{r.mensagem ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          {!resultados ? (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => mutation.mutate()}
                disabled={validos === 0 || mutation.isPending}
              >
                {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Importar {validos} usuário(s)
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={baixarResultado}>
                <FileDown className="w-4 h-4 mr-2" /> Baixar resultado
              </Button>
              <Button onClick={() => setOpen(false)}>Fechar</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
