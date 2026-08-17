import { readFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import unoCSS from "unocss/vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import { HvAppShellVitePlugin } from "@hitachivantara/app-shell-vite-plugin";

const mockServiceWorkerPath = path.resolve(
  "node_modules/msw/lib/mockServiceWorker.js",
);

const removeBareModuleScripts = () => ({
  name: "remove-bare-module-scripts",
  enforce: "post",
  transformIndexHtml(html: string) {
    return html.replaceAll(
      /<script type="module"[^>]+src="([^/.][^"']*)"[^>]*><\/script>/g,
      "",
    );
  },
});

const serveMockServiceWorker = () => ({
  name: "serve-mock-service-worker",
  configureServer(server: { middlewares: { use: typeof useMiddleware } }) {
    server.middlewares.use(useMiddleware);
  },
});

function useMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
) {
  if (req.url !== "/mockServiceWorker.js") {
    next();
    return;
  }

  readFile(mockServiceWorkerPath, "utf8")
    .then((script) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/javascript");
      res.end(script);
    })
    .catch(next);
}

export default defineConfig(async ({ mode }) => ({
  plugins: [
    react(),
    tsconfigPaths(),
    unoCSS({ mode: "per-module" }),
    cssInjectedByJsPlugin({ relativeCSSInjection: true }),
    serveMockServiceWorker(),
    ...(await HvAppShellVitePlugin({
      experimentalNewPackageLayout: true,
      disableAppsKeyNormalization: true,
      inlineConfig: true,
      mode,
      sourceCondition: "@home-lab",
      type: mode === "development" ? "app" : "bundle",
      modules: [
        "src/pages/Home",
        "src/pages/Editor",
        "src/pages/State",
        "src/providers/MockingProvider",
        "src/lib/useAccessControlState",
        "src/api/client",
        "src/api/mock-data",
        "src/mocks/browser",
        "src/mocks/handlers",
      ],
    })),
    removeBareModuleScripts(),
  ],
}));
