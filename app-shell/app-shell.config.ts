import type { AppShellVitePluginOptions } from "@hitachivantara/app-shell-vite-plugin";
import type { HvAppShellConfig } from "@hitachivantara/app-shell-shared";

export default function appShellConfig(_opts: AppShellVitePluginOptions): HvAppShellConfig {
  return {
    name: "Home Lab",
    logo: null,
    apps: {
      "$app/": "/",
      "$app/pages/Home.js": "/src/pages/Home",
      "$app/pages/Apps.js": "/src/pages/Apps",
      "$app/providers/CyberpunkThemeProvider.js": "/src/providers/CyberpunkThemeProvider",
    },
    navigationMode: "ONLY_LEFT",
    translationsBaseUrl: false,
    theming: {
      colorMode: "dark",
    },
    providers: [
      {
        bundle: "$app/providers/CyberpunkThemeProvider.js",
      },
    ],
    mainPanel: {
      disableGutters: true,
      maxWidth: false,
      views: [
        {
          bundle: "$app/pages/Home.js",
          route: "/",
        },
        {
          bundle: "$app/pages/Apps.js",
          route: "/apps",
        },
      ],
    },
    menu: [
      {
        label: "Dashboard",
        target: "/",
      },
      {
        label: "Configuration",
        target: "/apps",
      },
    ],
  };
}
