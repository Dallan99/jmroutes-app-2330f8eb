import { createFileRoute, Outlet, redirect, Link, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2, X, Gauge, BarChart3, Truck } from "lucide-react";
import { TV_FLAGS, TV_ROTA_INICIAL } from "@/lib/tv-flags";
import { useClock, formatTimeBR } from "@/lib/use-clock";

export const Route = createFileRoute("/tv")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const p = location.pathname.replace(/\/+$/, "");
    // Visões desativadas (indicadores zerados) caem na visão com dados reais.
    const desativada =
      p === "/tv" ||
      (!TV_FLAGS.visaoOperacional && p === "/tv/dashboard") ||
      (!TV_FLAGS.visaoGerencial && p === "/tv/gerencial");
    if (desativada) {
      throw redirect({ to: TV_ROTA_INICIAL, search: (s: Record<string, unknown>) => s });
    }
  },
  component: TvShell,
});

function TvShell() {
  const rs = useRouterState();
  const path = rs.location.pathname;
  const [isFs, setIsFs] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const agora = useClock(1000);

  const abas = [
    TV_FLAGS.visaoOperacional && { to: "/tv/dashboard", icon: Gauge, label: "Operacional" },
    TV_FLAGS.visaoGerencial && { to: "/tv/gerencial", icon: BarChart3, label: "Gerencial" },
    TV_FLAGS.visaoMeli && { to: "/tv/meli", icon: Truck, label: "Meli" },
  ].filter(Boolean) as { to: string; icon: typeof Gauge; label: string }[];

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  async function toggleFs() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {
      /* fullscreen pode ser bloqueado pelo navegador */
    }
  }

  return (
    <div ref={rootRef} className="h-screen overflow-hidden bg-[var(--brand-navy)] text-white flex flex-col">
      <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-white/10 bg-black/20">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] font-semibold text-[var(--brand-yellow)]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Operação Meli — Modo TV
          </span>
          {abas.length > 0 && (
            <nav className="flex items-center gap-1" aria-label="Visões do Modo TV">
              {abas.map((a) => (
                <TvNav key={a.to} to={a.to} icon={a.icon} label={a.label} active={path.startsWith(a.to)} />
              ))}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm tabular-nums text-white/70 xl:text-base" aria-label="Hora atual">
            {formatTimeBR(agora)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label={isFs ? "Sair da tela cheia" : "Entrar em tela cheia"}
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={toggleFs}
          >
            {isFs ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
          <Link to="/dashboard">
            <Button size="sm" variant="ghost" aria-label="Sair do Modo TV" className="text-white hover:bg-white/10 hover:text-white">
              <X className="w-4 h-4 mr-1" /> Sair
            </Button>
          </Link>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

function TvNav({ to, icon: Icon, label, active }: { to: string; icon: typeof Gauge; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-yellow)] ${
        active ? "bg-[var(--brand-yellow)] text-[var(--brand-navy)]" : "text-white/70 hover:text-white hover:bg-white/10"
      }`}
    >
      <Icon className="w-4 h-4" /> {label}
    </Link>
  );
}
