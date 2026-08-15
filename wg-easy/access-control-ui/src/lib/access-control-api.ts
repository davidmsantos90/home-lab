export const ACCESS_CONTROL_API_URL =
  import.meta.env.VITE_ACCESS_CONTROL_API_URL ?? "http://127.0.0.1:8787";

export interface AccessControlPeer {
  name: string;
  ipv4Address: string;
  raw: Record<string, unknown>;
}

export interface AccessControlAliasCatalog {
  groups: Record<string, string[]>;
  hosts: Record<string, string[]>;
  services: Record<string, Array<{ protocol: string; port: number }>>;
}

export interface AccessControlRule {
  source?: string | string[];
  source_group?: string | string[];
  destination?: string | string[];
  destination_group?: string | string[];
  service?: string | string[];
  protocol?: string;
  port?: number | string;
  action: string;
  comment?: string;
}

export interface AccessControlCompiledState {
  iptables: string[][];
  ipsets: Array<{ name: string; members: string[] }>;
}

export interface AccessControlState {
  backend: string;
  policyPath: string;
  aliasesPath: string;
  peers: AccessControlPeer[];
  peerMap: Record<string, string>;
  aliases: AccessControlAliasCatalog;
  rules: AccessControlRule[];
  compiled: AccessControlCompiledState;
}

function apiUrl(path: string) {
  return new URL(path, ACCESS_CONTROL_API_URL);
}

export async function fetchAccessControlState(
  signal?: AbortSignal,
): Promise<AccessControlState> {
  const response = await fetch(apiUrl("/api/state"), { signal });
  if (!response.ok) {
    throw new Error(`API request failed with ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as AccessControlState;
}
