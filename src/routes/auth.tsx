import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Loader2,
  Eye,
  EyeOff,
  LogIn,
  ShieldCheck,
  User as UserIcon,
  Lock,
  MapPin,
  Clock,
  Headphones,
  PackageCheck,
  ScanBarcode,
  ClipboardList,
  LineChart,
  History,
  Users as UsersIcon,
  Building2,
  FileSearch,
  Settings as SettingsIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import heroImg from "@/assets/jm-hero.png.asset.json";
import { JM_LOGO_URL } from "@/components/jm-logo";
import { obterUsuarioValidado, registrarUsuarioValidado } from "@/lib/auth-session";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — JM Transportes" },
      { name: "description", content: "Acesso ao sistema de recebimento de rotas." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s.next === "string" ? { next: s.next } : {},
  component: AuthPage,
});

function safeNext(next: string | undefined): string | null {
  if (!next) return null;
  // Only allow same-origin relative paths like "/.lovable/oauth/consent?..."
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

function traduzirErroAuth(mensagem: string): string {
  const mensagemNormalizada = mensagem.toLowerCase();

  if (mensagemNormalizada.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (mensagemNormalizada.includes("email not confirmed")) return "Confirme seu e-mail antes de entrar.";
  if (mensagemNormalizada.includes("user already registered")) return "Este e-mail já está cadastrado.";
  if (mensagemNormalizada.includes("password is known to be weak")) return "Essa senha é muito fraca. Escolha uma senha mais forte.";
  if (mensagemNormalizada.includes("rate limit")) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";

  return "Não foi possível concluir a autenticação. Tente novamente.";
}

async function destinoAposLogin(userId: string) {
  const { data: perfil } = await supabase
    .from("profiles")
    .select("meli_driver_id")
    .eq("id", userId)
    .maybeSingle();
  return perfil?.meli_driver_id ? "/motorista" : "/dashboard";
}

function AuthPage() {
  const { next } = Route.useSearch();
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [showSenha, setShowSenha] = useState(false);
  const [remember, setRemember] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  useEffect(() => {
    let ativo = true;

    async function validarSessaoInicial() {
      try {
        const { data: sessao } = await supabase.auth.getSession();
        if (!sessao.session) return;

        // A sessão local é apenas um ponto de partida. O usuário precisa ser
        // confirmado pelo Supabase antes de permitir qualquer navegação.
        const { data: usuario, error } = await obterUsuarioValidado();
        if (error || !usuario.user) {
          await supabase.auth.signOut({ scope: "local" });
          return;
        }

        if (!ativo) return;
        const target = safeNext(next);
        window.location.href = target ?? await destinoAposLogin(usuario.user.id);
      } catch {
        // Falhas de sessão local não devem retirar o usuário da tela de acesso.
        await supabase.auth.signOut({ scope: "local" });
      } finally {
        if (ativo) setHydrated(true);
      }
    }

    void validarSessaoInicial();
    return () => {
      ativo = false;
    };
  }, [next]);

  if (!hydrated) return null;


  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const identificador = email.trim().toLowerCase();
      const emailLogin = identificador.includes("@")
        ? identificador
        : `${identificador}@motoristas.jmroutes.local`;
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailLogin,
        password: senha,
      });

      if (error) {
        const mensagem = error.message?.trim();
        return toast.error(
          mensagem
            ? traduzirErroAuth(mensagem)
            : "Não foi possível realizar o login. Verifique e-mail, senha e conexão.",
        );
      }

      if (!data.session || !data.user) {
        return toast.error("Não foi possível realizar o login. Verifique e-mail, senha e conexão.");
      }

      // signInWithPassword acabou de validar as credenciais no Supabase. Guardamos
      // esse mesmo usuário por poucos segundos para a abertura do Dashboard não
      // repetir duas chamadas lentas ao Auth durante a mesma entrada.
      registrarUsuarioValidado(data.user);

      try {
        const { registrarAudit } = await import("@/lib/audit.functions");
        await registrarAudit({ data: { acao: "login", entidade: "auth", detalhes: { email } } });
      } catch {
        /* nunca bloqueia login por auditoria */
      }

      toast.success("Bem-vindo!");
      const target = safeNext(next);
      window.location.href = target ?? await destinoAposLogin(data.user.id);
    } catch {
      toast.error("Não foi possível realizar o login. Verifique e-mail, senha e conexão.");
    } finally {
      setLoading(false);
    }
  }


  async function enviarResetSenha(e: React.FormEvent) {
    e.preventDefault();
    const emailNorm = forgotEmail.trim().toLowerCase();
    if (!emailNorm.endsWith("@jmdistribuicao.com.br")) {
      return toast.error("Apenas emails @jmdistribuicao.com.br podem redefinir a senha.");
    }
    setForgotLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(emailNorm, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setForgotLoading(false);
    if (error) return toast.error(traduzirErroAuth(error.message));
    toast.success("Enviamos um link de redefinição para seu e-mail.");
    setForgotOpen(false);
    setForgotEmail("");
  }

  return (
    <div
      className="min-h-screen flex flex-col text-white"
      style={{
        background:
          "linear-gradient(135deg, #0A1A3A 0%, #0F2348 60%, #0A1A3A 100%)",
      }}
    >
      {/* Área principal: split hero (esquerda) + card de login (direita) */}
      <div className="flex-1 grid lg:grid-cols-[1.15fr_1fr] gap-0">
        {/* ===== Esquerda ===== */}
        <div className="relative overflow-hidden">
          {/* imagem de fundo */}
          <img
            src={heroImg.url}
            alt="Frota JM Transportes"
            className="absolute inset-0 w-full h-full object-cover object-center opacity-90"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0A1A3A] via-[#0A1A3A]/70 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0A1A3A] via-transparent to-transparent" />

          {/* padrão de pontos sutil */}
          <div
            className="absolute inset-0 opacity-[0.08] pointer-events-none"
            style={{
              backgroundImage:
                "radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
            }}
          />

          <div className="relative z-10 h-full flex flex-col justify-between p-8 md:p-14">
            {/* Branding */}
            <div>
              <div className="flex items-center gap-4">
                <img
                  src={JM_LOGO_URL}
                  alt="JM"
                  className="w-16 h-16 md:w-20 md:h-20 rounded-lg shadow-lg"
                />
                <div>
                  <h1 className="font-display font-black text-4xl md:text-5xl leading-none">
                    JM <span className="text-[#F5B800]">ROUTES</span>
                  </h1>
                  <div className="text-[10px] md:text-xs uppercase tracking-[0.28em] text-white/70 mt-1">
                    Sistema de Gestão Operacional
                  </div>
                </div>
              </div>

              <p className="mt-8 text-lg md:text-xl text-white/90 max-w-md leading-snug">
                Gestão completa para o seu{" "}
                <span className="text-[#F5B800] font-semibold">Last Mile</span>{" "}
                com eficiência, controle e inteligência em tempo real.
              </p>
            </div>

            {/* Grid de features */}
            <div className="mt-10 bg-[#0A1A3A]/70 backdrop-blur-sm border border-white/10 rounded-xl p-5 md:p-6">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-5 md:gap-4">
                {[
                  { icon: PackageCheck, title: "Recebimento", desc: "Importe e controle suas cargas" },
                  { icon: ScanBarcode, title: "Triagem", desc: "Bipagem rápida e sem erros" },
                  { icon: ClipboardList, title: "Contagem", desc: "Conferência ágil e precisa" },
                  { icon: LineChart, title: "Dashboard", desc: "Indicadores em tempo real" },
                  { icon: History, title: "Histórico", desc: "Rastreabilidade de ponta a ponta" },
                ].map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="text-center md:text-left">
                    <Icon className="w-6 h-6 text-[#F5B800] mx-auto md:mx-0 mb-2" />
                    <div className="font-semibold text-sm">{title}</div>
                    <div className="text-[11px] text-white/60 leading-tight mt-0.5">
                      {desc}
                    </div>
                  </div>
                ))}
              </div>
              <div className="my-5 border-t border-white/10" />
              <div className="grid grid-cols-2 md:grid-cols-5 gap-5 md:gap-4">
                {[
                  { icon: UsersIcon, title: "Usuários", desc: "Gestão de acessos e permissões" },
                  { icon: Building2, title: "Bases", desc: "Múltiplas bases operacionais" },
                  { icon: FileSearch, title: "Auditoria", desc: "Logs completos de operações" },
                  { icon: SettingsIcon, title: "Configurações", desc: "Personalize conforme sua operação" },
                  { icon: ShieldCheck, title: "Segurança", desc: "Proteção de dados e conformidade" },
                ].map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="text-center md:text-left">
                    <Icon className="w-6 h-6 text-[#F5B800] mx-auto md:mx-0 mb-2" />
                    <div className="font-semibold text-sm">{title}</div>
                    <div className="text-[11px] text-white/60 leading-tight mt-0.5">
                      {desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ===== Direita — Card de login ===== */}
        <div className="flex items-center justify-center p-6 md:p-10 bg-transparent">
          <div className="w-full max-w-md bg-white text-slate-800 rounded-2xl shadow-2xl p-8 md:p-10">
            <div className="flex justify-center mb-5">
              <div className="w-14 h-14 rounded-full bg-[#F5B800]/15 flex items-center justify-center">
                <ShieldCheck className="w-7 h-7 text-[#F5B800]" />
              </div>
            </div>
            <h2 className="text-center font-display text-3xl font-bold text-[#0F2348]">
              Bem-vindo de volta!
            </h2>
            <p className="text-center text-sm text-slate-500 mt-1">
              Faça login para acessar o sistema
            </p>

            <form onSubmit={entrar} className="space-y-4 mt-6" autoComplete="off">
              <div className="space-y-2">
                <Label htmlFor="email" className="sr-only">
                  Usuário ou e-mail
                </Label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="email"
                    type="text"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Usuário ou e-mail"
                    className="pl-9 h-12 bg-slate-50 border-slate-200 focus-visible:ring-[#F5B800]"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="senha" className="sr-only">
                  Senha
                </Label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="senha"
                    type={showSenha ? "text" : "password"}
                    required
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    placeholder="Senha"
                    className="pl-9 pr-10 h-12 bg-slate-50 border-slate-200 focus-visible:ring-[#F5B800]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSenha((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                    aria-label={showSenha ? "Ocultar senha" : "Mostrar senha"}
                    tabIndex={-1}
                  >
                    {showSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 accent-[#0F2348]"
                  />
                  Lembrar-me
                </label>
                <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
                  <DialogTrigger asChild>
                    <button type="button" className="text-[#0F2348] hover:underline font-medium">
                      Esqueci minha senha
                    </button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Redefinir senha</DialogTitle>
                      <DialogDescription>
                        Informe seu email e enviaremos um link para você criar uma nova senha.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={enviarResetSenha} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="forgot-email">Email</Label>
                        <Input
                          id="forgot-email"
                          type="email"
                          required
                          value={forgotEmail}
                          onChange={(e) => setForgotEmail(e.target.value)}
                          placeholder="voce@jmdistribuicao.com.br"
                        />
                      </div>
                      <DialogFooter>
                        <Button type="submit" disabled={forgotLoading} className="w-full">
                          {forgotLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                          Enviar link de redefinição
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-[#0F2348] hover:bg-[#152e5e] text-white font-semibold text-base"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4 mr-2" />
                )}
                Entrar
              </Button>
            </form>

            <div className="mt-8 text-center text-xs text-slate-500 flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Ambiente seguro e monitorado
            </div>
            <div className="text-center text-xs text-slate-400 mt-1">
              JM Routes — Todos os direitos reservados.
            </div>
          </div>
        </div>
      </div>

      {/* Faixa inferior de informações */}
      <div className="bg-[#0A1A3A]/80 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-5 grid grid-cols-2 md:grid-cols-4 gap-5">
          {[
            {
              icon: MapPin,
              title: "BASES OPERACIONAIS",
              desc: "Embu Guaçu · Guarujá · Ibiúna · Franco da Rocha",
            },
            {
              icon: ShieldCheck,
              title: "SEGURANÇA",
              desc: "Seus dados protegidos com criptografia avançada",
            },
            {
              icon: Clock,
              title: "TEMPO REAL",
              desc: "Informações atualizadas instantaneamente",
            },
            {
              icon: Headphones,
              title: "SUPORTE",
              desc: "Em caso de dúvidas, entre em contato com o administrador",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3">
              <Icon className="w-5 h-5 text-[#F5B800] shrink-0 mt-0.5" />
              <div>
                <div className="text-[11px] font-bold tracking-wider text-white">
                  {title}
                </div>
                <div className="text-[11px] text-white/60 leading-tight mt-0.5">
                  {desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
