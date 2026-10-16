import { defineConfig } from "vitest/config";

// O worker é um pacote independente do frontend. Evita carregar a
// configuração Vitest da raiz quando só as dependências do worker existem.
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
