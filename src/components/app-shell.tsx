import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  PackageSearch,
  ClipboardList,
  History,
  TrendingUp,
  Users,
  Settings,
  ShieldCheck,
  LogOut,
  Boxes,
  RotateCcw,
  ShieldAlert,
  Smartphone,
  Truck,
  Activity,
} from "lucide-react";
import { JmLogo, JmWordmark } from "@/components/jm-logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { meuPerfil } from "@/lib/recebimento.functions";
import { toast } from "sonner";
import { BaseOperacionalProvider, useBaseOperacional } from "@/lib/base-operacional-context";
import { SeletorBaseDia } from "@/components/base-operacional-selector";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CollectorModeProvider, useCollectorMode } from "@/lib/collector-mode";
import { isPwaStandalone } from "@/lib/pwa-install";

const ROTAS_APP_COLETOR = new Set(["/coletor", "/recebimento", "/triagem", "/expedicao", "/motorista", "/meli-devolucoes"]);

const INACTIVITY_MS = 4 * 60 * 60 * 1000;

function useInactivityLogout() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        try {
          const { registrarAudit } = await import("@/lib/audit.functions");
          await registrarAudit({ data: { acao: "logout.inatividade", entidade: "auth" } });
        } catch {
          /* ignore */
        }
        await supabase.auth.signOut();
        toast.info("Sessão expirada por inatividade. Faça login novamente.");
        window.location.href = "/auth";
      }, INACTIVITY_MS);
    };
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}

type NavItem = {
  title: string;
  to: string;
  icon: typeof LayoutDashboard;
  soon?: boolean;
  roles?: Array<Role>;
};

type Role = "admin" | "supervisor" | "gerente" | "operador";

const NAV_OPERACIONAL: NavItem[] = [
  { title: "Modo coletor", to: "/coletor", icon: Smartphone },
  { title: "Bases", to: "/bases", icon: Boxes },
  { title: "Dashboard", to: "/dashboard", icon: TrendingUp, roles: ["admin", "supervisor", "gerente"] },
  { title: "Painel Operacional", to: "/painel-operacional", icon: TrendingUp },
  { title: "Recebimento", to: "/triagem", icon: PackageSearch },
  { title: "Expedição", to: "/expedicao", icon: Truck },
  { title: "Contagem", to: "/contagem", icon: ClipboardList },
  { title: "Devoluções", to: "/meli-devolucoes", icon: RotateCcw },
  { title: "Inventário", to: "/inventario-central", icon: ClipboardList },
];
const NAV_GESTAO: NavItem[] = [
  { title: "Gerencial", to: "/gerencial", icon: TrendingUp, roles: ["admin", "supervisor", "gerente"] },
  { title: "Auditoria", to: "/auditoria", icon: ShieldCheck, roles: ["admin"] },
  { title: "Usuários", to: "/usuarios", icon: Users, roles: ["admin"] },
  { title: "Integração Meli", to: "/integracao-meli", icon: PackageSearch, roles: ["admin", "supervisor", "gerente"] },
  { title: "Monitoramento de Workers", to: "/monitoramento-workers", icon: Activity, roles: ["admin", "supervisor", "gerente"] },
  { title: "Histórico", to: "/historico", icon: History, roles: ["admin", "supervisor", "gerente"] },
  { title: "Área de Risco", to: "/meli-risco", icon: ShieldAlert, roles: ["admin", "supervisor", "gerente"] },
];
const NAV_ADMIN: NavItem[] = [
  { title: "Motoristas", to: "/motoristas", icon: Truck, roles: ["admin"] },
  { title: "Configurações", to: "/configuracoes", icon: Settings, roles: ["admin"] },
];

// Fonte única do menu normal. Os grupos e a ordem não dependem da rota atual.
const NAV_SECTIONS = [
  { label: "Operação", items: NAV_OPERACIONAL },
  { label: "Gestão", items: NAV_GESTAO },
  { label: "Administração", items: NAV_ADMIN },
] as const;

const NAV_COLETOR: NavItem[] = [
  { title: "Recebimento", to: "/triagem", icon: PackageSearch },
  { title: "Expedição", to: "/expedicao", icon: Truck },
  { title: "Devoluções", to: "/meli-devolucoes", icon: RotateCcw },
];

export function AppShell() {
  return (
    <CollectorModeProvider>
      <AppShellContent />
    </CollectorModeProvider>
  );
}

function AppShellContent() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [appColetorInstalado, setAppColetorInstalado] = useState(() => isPwaStandalone());
  const fetchPerfil = useServerFn(meuPerfil);
  const perfilQuery = useQuery({
    queryKey: ["meu-perfil"],
    queryFn: () => fetchPerfil(),
    staleTime: 60_000,
    refetchInterval: (query) => query.state.data?.indisponivelTemporariamente ? 5_000 : false,
  });
  const rolesCarregadas = perfilQuery.isSuccess;
  const roles = (perfilQuery.data?.roles ?? []) as Array<Role>;
  const { modoColetor, sairModoColetor } = useCollectorMode();
  const modoColetorAtivo = ROTAS_APP_COLETOR.has(pathname) && (appColetorInstalado || modoColetor);
  useInactivityLogout();

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const atualizar = () => setAppColetorInstalado(isPwaStandalone());
    atualizar();
    media.addEventListener?.("change", atualizar);
    return () => media.removeEventListener?.("change", atualizar);
  }, []);

  useEffect(() => {
    if (appColetorInstalado && !ROTAS_APP_COLETOR.has(pathname)) {
      navigate({ to: "/coletor", replace: true });
      return;
    }
    if (!appColetorInstalado && modoColetor && !ROTAS_APP_COLETOR.has(pathname)) {
      sairModoColetor();
    }
  }, [appColetorInstalado, modoColetor, navigate, pathname, sairModoColetor]);

  if (pathname.startsWith("/motorista")) return <Outlet />;

  return (
    <BaseOperacionalProvider>
      <SidebarProvider>
        <div className="min-h-screen flex w-full bg-background">
          <AppSidebar roles={roles} rolesCarregadas={rolesCarregadas} modoColetor={modoColetorAtivo} />
          <div className="flex-1 flex flex-col min-w-0">
            <TopBar nome={perfilQuery.data?.profile?.nome ?? null} roles={roles} rolesCarregadas={rolesCarregadas} modoColetor={modoColetorAtivo} appColetorInstalado={appColetorInstalado} />
            <main className={`flex-1 min-w-0 ${modoColetorAtivo ? "pb-20" : ""}`}>
              <Outlet />
            </main>
            {modoColetorAtivo && <CollectorBottomNav />}
          </div>
        </div>
      </SidebarProvider>
    </BaseOperacionalProvider>
  );
}

function AppSidebar({ roles, rolesCarregadas, modoColetor }: { roles: Array<Role>; rolesCarregadas: boolean; modoColetor: boolean }) {

  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Gestão nunca perde o menu completo: a sidebar simplificada do coletor só
  // substitui os grupos normais para operador/coletor, e apenas após o perfil
  // carregar (evita troca de menu no primeiro render).
  const gestaoCompleta = roles.includes("admin") || roles.includes("gerente") || roles.includes("supervisor");
  const usarMenuColetor = modoColetor && rolesCarregadas && !gestaoCompleta;
  // Itens restritos só aparecem depois que os papéis chegam, evitando o flash
  // do menu completo seguido do "sumiço" dos itens.
  const allow = (item: NavItem) =>
    !item.roles || (rolesCarregadas && item.roles.some((r) => roles.includes(r)));

  const renderGroup = (label: string, items: NavItem[]) => {
    const visible = items.filter(allow);
    if (!visible.length) return null;
    return (
      <SidebarGroup>
        {!collapsed && <SidebarGroupLabel className="text-sidebar-foreground/50 uppercase tracking-[0.14em] text-[10px]">{label}</SidebarGroupLabel>}
        <SidebarGroupContent>
          <SidebarMenu>
            {visible.map((item) => {
              const active = pathname === item.to || (item.to !== "/dashboard" && pathname.startsWith(`${item.to}/`));
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild={!item.soon}
                    isActive={active}
                    disabled={item.soon}
                    tooltip={item.title}
                    className={item.soon ? "opacity-50 cursor-not-allowed" : ""}
                  >
                    {item.soon ? (
                      <div className="flex items-center gap-2 w-full">
                        <item.icon className="w-4 h-4 shrink-0" />
                        {!collapsed && (
                          <>
                            <span className="truncate">{item.title}</span>
                            <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-sidebar-accent/60 text-sidebar-foreground/60 uppercase">em breve</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <Link
                        to={item.to}
                        className="flex items-center gap-2"
                        onClick={() => isMobile && setOpenMobile(false)}
                      >
                        <item.icon className="w-4 h-4 shrink-0" />
                        {!collapsed && <span className="truncate">{item.title}</span>}
                      </Link>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border h-14 flex items-center justify-center px-3">
        <Link to={modoColetor ? "/coletor" : "/dashboard"} title={modoColetor ? "Ir para o início do Coletor" : "Ir para o Dashboard"} className="flex items-center justify-center w-full">
          {collapsed ? <JmLogo size={28} /> : <JmWordmark />}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {usarMenuColetor ? renderGroup("Coletor", NAV_COLETOR) : (
          <>
            {NAV_SECTIONS.map(({ label, items }) => (
              <Fragment key={label}>{renderGroup(label, items)}</Fragment>
            ))}
          </>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && <div className="text-[10px] text-sidebar-foreground/50 px-2 py-1">v1.0 · Iteração 1</div>}
      </SidebarFooter>
    </Sidebar>
  );
}

function TopBar({ nome, roles, rolesCarregadas, modoColetor, appColetorInstalado }: { nome: string | null; roles: string[]; rolesCarregadas: boolean; modoColetor: boolean; appColetorInstalado: boolean }) {

  const navigate = useNavigate();
  const qc = useQueryClient();
  const { base, diaOperacional, limpar } = useBaseOperacional();
  const { sairModoColetor } = useCollectorMode();
  const [trocarOpen, setTrocarOpen] = useState(false);
  const principal = roles.includes("admin")
    ? "Administrador"
    : roles.includes("gerente")
    ? "Gerente"
    : roles.includes("supervisor")
    ? "Supervisor"
    : "Operador";

  async function logout() {
    try {
      const { registrarAudit } = await import("@/lib/audit.functions");
      await registrarAudit({ data: { acao: "logout", entidade: "auth" } });
    } catch {
      /* segue o logout mesmo sem auditoria */
    }
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast.success("Sessão encerrada.");
    navigate({ to: "/auth", replace: true });
  }

  function sairDoColetor() {
    sairModoColetor();
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <header className="h-12 md:h-14 border-b bg-card flex items-center px-2 md:px-3 gap-2 md:gap-3 sticky top-0 z-30">
      <SidebarTrigger className="h-10 w-10 md:h-7 md:w-7" />
      <div className={`min-w-0 ${modoColetor ? "" : "md:hidden"}`}>
        <p className="truncate text-sm font-semibold">{modoColetor ? "JMRoutes Coletor" : "JMRoutes"}</p>
        {base && diaOperacional && (
          <p className="truncate text-[10px] text-muted-foreground">
            {base.codigo} · {new Date(diaOperacional + "T00:00:00").toLocaleDateString("pt-BR")}
          </p>
        )}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right leading-tight md:block">
          <div className="text-sm font-medium">{nome ?? "—"}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {rolesCarregadas ? principal : "—"}
            {base && diaOperacional && (
              <>
                {" · "}
                <span className="font-mono normal-case">{base.codigo} · {new Date(diaOperacional + "T00:00:00").toLocaleDateString("pt-BR")}</span>
              </>
            )}
          </div>

        </div>
        <div className="hidden w-8 h-8 rounded-full brand-gradient text-white md:flex items-center justify-center text-xs font-bold uppercase">{(nome ?? "?").slice(0, 2)}</div>
        {modoColetor && !appColetorInstalado && (
          <Button variant="outline" className="h-10 px-3 text-xs" onClick={sairDoColetor}>
            Sair do modo leitor
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-10 w-10 md:h-9 md:w-9" onClick={logout} title="Sair">
          <LogOut className="w-4 h-4" />
        </Button>
      </div>

      <Dialog open={trocarOpen} onOpenChange={setTrocarOpen}>
        <DialogContent className="max-w-3xl p-0 bg-transparent border-none shadow-none">
          <SeletorBaseDia
            titulo="Trocar Base Operacional"
            descricao="Escolha a Base e o Dia com que você quer trabalhar."
            onSelecionar={() => setTrocarOpen(false)}
          />
          {base && (
            <div className="text-center pb-4">
              <Button variant="ghost" size="sm" onClick={() => { limpar(); setTrocarOpen(false); }}>
                Limpar seleção
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </header>
  );
}

function CollectorBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      aria-label="Funções do coletor"
      className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-3 border-t bg-card/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur"
    >
      {NAV_COLETOR.map((item) => {
        const active = pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-[11px] font-medium transition-colors ${
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground active:bg-muted"
            }`}
          >
            <item.icon className="h-5 w-5" />
            <span className="truncate">{item.title}</span>
          </Link>
        );
      })}
    </nav>
  );
}
