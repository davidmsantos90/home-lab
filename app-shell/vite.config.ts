import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import unoCSS from "unocss/vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import { HvAppShellVitePlugin } from "@hitachivantara/app-shell-vite-plugin";

const localShellEntries = {
  "pages/Home": fileURLToPath(new URL("./src/pages/Home.tsx", import.meta.url)),
  "pages/Apps": fileURLToPath(new URL("./src/pages/Apps.tsx", import.meta.url)),
  "providers/CyberpunkThemeProvider": fileURLToPath(
    new URL("./src/providers/CyberpunkThemeProvider.tsx", import.meta.url),
  ),
};

export default defineConfig(async ({ mode }) => ({
  build: {
    rollupOptions: {
      input: localShellEntries,
    },
  },
  plugins: [
    react(),
    tsconfigPaths(),
    unoCSS({ mode: "per-module" }),
    cssInjectedByJsPlugin({ relativeCSSInjection: true }),
    ...(await HvAppShellVitePlugin({
      experimentalNewPackageLayout: true,
      disableAppsKeyNormalization: true,
      inlineConfig: true,
      generateEmptyShell: true,
      mode,
      sourceCondition: "@home-lab",
      type: "app",
      modules: [
        "src/pages/Home",
        "src/pages/Apps",
        "src/providers/CyberpunkThemeProvider",
      ],
    })),
  ],
}));
