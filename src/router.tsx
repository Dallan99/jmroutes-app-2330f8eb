import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Nada de refetch em abas em segundo plano nem a cada foco: com o banco
        // sob carga isso multiplicava as consultas pesadas por usuário.
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        // Uma nova tentativa só; o próprio intervalo de atualização tenta de novo.
        retry: 1,
        retryDelay: (tentativa) => Math.min(2_000 * 2 ** tentativa, 15_000),
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
