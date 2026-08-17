export interface AppShellRuntimeConfig {
  name?: string;
  logo?: string | null;
  apps: Record<string, string>;
  navigationMode?: string;
  translationsBaseUrl?: boolean | string;
  theming?: {
    theme?: string;
  };
  mainPanel?: {
    disableGutters?: boolean;
    maxWidth?: boolean;
    views?: Array<{
      bundle: string;
      route: string;
    }>;
  };
  menu?: Array<{
    label: string;
    target: string;
  }>;
}

declare global {
  interface Window {
    __APP_SHELL_RUNTIME_CONFIG__?: AppShellRuntimeConfig;
  }
}

const defaultRuntimeConfig: AppShellRuntimeConfig = {
  name: "Home Lab",
  apps: {},
  menu: [],
  mainPanel: {
    views: [],
  },
};

export function getRuntimeConfig(): AppShellRuntimeConfig {
  if (typeof window === "undefined") {
    return defaultRuntimeConfig;
  }
  return window.__APP_SHELL_RUNTIME_CONFIG__ ?? defaultRuntimeConfig;
}
