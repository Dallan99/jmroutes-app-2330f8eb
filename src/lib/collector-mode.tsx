import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "jmroutes:modo-coletor";

function collectorStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

type CollectorModeContextValue = {
  modoColetor: boolean;
  ativarModoColetor: () => void;
  sairModoColetor: () => void;
};

const CollectorModeContext = createContext<CollectorModeContextValue | null>(null);

export function CollectorModeProvider({ children }: { children: ReactNode }) {
  const [modoColetor, setModoColetor] = useState(false);

  useEffect(() => {
    // O modo coletor pertence somente à aba/sessão que entrou pelo /coletor.
    // Preferências antigas persistentes não devem reabrir o site normal no coletor.
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* armazenamento pode estar indisponível em navegadores restritos */
    }
    setModoColetor(collectorStorage()?.getItem(STORAGE_KEY) === "1");
  }, []);

  const ativarModoColetor = useCallback(() => {
    collectorStorage()?.setItem(STORAGE_KEY, "1");
    setModoColetor(true);
  }, []);

  const sairModoColetor = useCallback(() => {
    // A saída precisa limpar a sessão da aba para não ocultar a sidebar normal
    // durante a navegação seguinte.
    collectorStorage()?.removeItem(STORAGE_KEY);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* limpa somente quando o armazenamento estiver disponível */
    }
    setModoColetor(false);
  }, []);

  const value = useMemo<CollectorModeContextValue>(() => ({
    modoColetor,
    ativarModoColetor,
    sairModoColetor,
  }), [ativarModoColetor, modoColetor, sairModoColetor]);

  return <CollectorModeContext.Provider value={value}>{children}</CollectorModeContext.Provider>;
}

export function useCollectorMode() {
  const context = useContext(CollectorModeContext);
  if (!context) throw new Error("useCollectorMode deve ser usado dentro de CollectorModeProvider.");
  return context;
}
