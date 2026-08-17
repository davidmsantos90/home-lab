import type { AppShellVitePluginOptions } from "@hitachivantara/app-shell-vite-plugin";
import type { HvAppShellConfig } from "@hitachivantara/app-shell-shared";
import config from "./app-shell.config.json";

export default function appShellConfig(_opts: AppShellVitePluginOptions): HvAppShellConfig {
  return config;
}
