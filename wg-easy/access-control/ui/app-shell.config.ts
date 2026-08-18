import type { HvAppShellConfig } from "@hitachivantara/app-shell-shared";
import type { AppShellVitePluginOptions } from "@hitachivantara/app-shell-vite-plugin";

export default function appShellConfig(
  _opts: AppShellVitePluginOptions,
): HvAppShellConfig {
  return {
    name: "wg-easy access control",
    logo: null,
    apps: {
      "$app/": "/",
      "$app/pages/Home.js": "/src/pages/Home",
      "$app/pages/Editor.js": "/src/pages/Editor",
      "$app/pages/State.js": "/src/pages/State",
      "$app/providers/AppProvider.js": "/src/providers/AppProvider",
      "$app/providers/MockingProvider.js": "/src/providers/MockingProvider",
    },
    navigationMode: "ONLY_LEFT",
    translationsBaseUrl: false,
    theming: {
      colorMode: "dark",
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
        bundle: "$app/providers/AppProvider.js",
      },
      {
        bundle: "$app/providers/MockingProvider.js",
      },
    ],
  };
}
