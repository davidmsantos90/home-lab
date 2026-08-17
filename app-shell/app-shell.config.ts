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
    },
    navigationMode: "ONLY_LEFT",
    translationsBaseUrl: false,
    theming: {
      theme: "pentaho",
    },
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
