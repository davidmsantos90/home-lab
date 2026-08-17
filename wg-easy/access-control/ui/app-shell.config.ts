import type { AppShellVitePluginOptions } from "@hitachivantara/app-shell-vite-plugin";
import type { HvAppShellConfig } from "@hitachivantara/app-shell-shared";

export default function appShellConfig(_opts: AppShellVitePluginOptions): HvAppShellConfig {
  return {
    name: "wg-easy access control",
    logo: null,
    apps: {
      "$app/": "/",
      "$app/pages/Home.js": "/src/pages/Home",
      "$app/pages/Editor.js": "/src/pages/Editor",
      "$app/pages/State.js": "/src/pages/State",
      "$app/providers/MockingProvider.js": "/src/providers/MockingProvider",
      "$app/api/client.js": "/src/api/client",
      "$app/api/mock-data.js": "/src/api/mock-data",
      "$app/mocks/browser.js": "/src/mocks/browser",
      "$app/mocks/handlers.js": "/src/mocks/handlers",
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
          bundle: "$app/pages/Editor.js",
          route: "/editor",
        },
        {
          bundle: "$app/pages/State.js",
          route: "/state",
        },
      ],
    },
    menu: [
      {
        label: "Dashboard",
        target: "/",
      },
      {
        label: "Editor",
        target: "/editor",
      },
      {
        label: "Raw state",
        target: "/state",
      },
    ],
    providers: [
      {
        bundle: "$app/providers/MockingProvider.js",
      },
    ],
  };
}
