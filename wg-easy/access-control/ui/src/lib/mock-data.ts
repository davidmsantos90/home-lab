import type {
  AccessControlAliasCatalog,
  AccessControlCompiledState,
  AccessControlConfigDocument,
  AccessControlConfigDraft,
  AccessControlRule,
  AccessControlState,
} from "../api/apiSchemas";

const MOCK_POLICY_PATH = "/etc/wg-easy/access-control/policies.json";
const MOCK_ALIASES_PATH = "/etc/wg-easy/access-control/aliases.json";

const mockPeers: AccessControlState["peers"] = [
  {
    name: "phone",
    ipv4Address: "10.8.0.2",
    raw: { endpoint: "198.51.100.8:51820" },
  },
  {
    name: "laptop",
    ipv4Address: "10.8.0.3",
    raw: { endpoint: "198.51.100.10:51820" },
  },
  {
    name: "tablet",
    ipv4Address: "10.8.0.4",
    raw: { endpoint: "198.51.100.11:51820" },
  },
];

const mockPeerMap: AccessControlState["peerMap"] = Object.fromEntries(
  mockPeers.map((peer) => [peer.name, peer.ipv4Address]),
);

export const mockAccessControlConfigDraft: AccessControlConfigDraft = {
  aliases: {
    groups: {
      family: ["phone", "tablet"],
      work: ["laptop"],
    },
    hosts: {
      raspberry: ["192.168.1.60"],
      nas: ["192.168.1.10"],
    },
    services: {
      ssh: [{ protocol: "tcp", port: 22 }],
      admin: [
        { protocol: "tcp", port: 443 },
        { protocol: "tcp", port: 8443 },
      ],
      dns: [{ protocol: "udp", port: 53 }],
    },
  },
  rules: [
    {
      source: ["family"],
      destination: ["raspberry"],
      service: ["ssh"],
      action: "allow",
      comment: "Household access to Raspberry Pi admin SSH",
    },
    {
      source: ["laptop"],
      destination: ["work"],
      service: ["admin"],
      action: "allow",
      comment: "Laptop can reach office services",
    },
    {
      source: ["work"],
      destination: ["nas"],
      service: ["dns"],
      action: "deny",
      comment: "Block DNS from work devices to NAS segment",
    },
  ],
};

function toArray(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

function dedupe(values: string[]) {
  return [...new Set(values)];
}

function resolveSelectorMembers(
  selector: string | string[] | undefined,
  aliases: AccessControlAliasCatalog,
) {
  return dedupe(
    toArray(selector).flatMap(
      (entry) => aliases.groups[entry] ?? [entry],
    ),
  );
}

function resolveSources(
  rule: AccessControlRule,
  aliases: AccessControlAliasCatalog,
) {
  return dedupe(
    resolveSelectorMembers(rule.source, aliases).map(
      (entry) => mockPeerMap[entry] ?? entry,
    ),
  );
}

function resolveDestinations(
  rule: AccessControlRule,
  aliases: AccessControlAliasCatalog,
) {
  return dedupe(
    resolveSelectorMembers(rule.destination, aliases).flatMap(
      (entry) => aliases.hosts[entry] ?? [mockPeerMap[entry] ?? entry],
    ),
  );
}

function resolveServices(
  rule: AccessControlRule,
  aliases: AccessControlAliasCatalog,
) {
  if (!rule.service) {
    return [{ protocol: rule.protocol, port: rule.port }];
  }
  return toArray(rule.service).flatMap((serviceName) => {
    const entries = aliases.services[serviceName];
    return entries && entries.length > 0
      ? entries
      : [{ protocol: rule.protocol, port: rule.port }];
  });
}

function buildCompiledState(
  aliases: AccessControlAliasCatalog,
  rules: AccessControlRule[],
): AccessControlCompiledState {
  const iptables = rules.flatMap((rule) => {
    const action = rule.action.toLowerCase() === "deny" ? "DROP" : "ACCEPT";
    return resolveSources(rule, aliases).flatMap((source) =>
      resolveDestinations(rule, aliases).flatMap((destination) =>
        resolveServices(rule, aliases).map((serviceEntry) => {
          const command = [
            "-A",
            "WG_ACCESS_CONTROL",
            "-s",
            source,
            "-d",
            destination,
          ];
          if (serviceEntry.protocol) {
            command.push("-p", serviceEntry.protocol);
          }
          if (serviceEntry.port !== undefined && serviceEntry.port !== null) {
            command.push("--dport", String(serviceEntry.port));
          }
          command.push("-j", action);
          return command;
        }),
      ),
    );
  });

  const ipsets = Object.entries(aliases.groups)
    .map(([groupName, members]) => ({
      name: `wgac_${groupName}`,
      members: dedupe(members.map((member) => mockPeerMap[member] ?? member)),
    }))
    .filter((entry) => entry.members.length > 0);

  return {
    iptables,
    ipsets,
  };
}

export function buildMockAccessControlState(
  draft: AccessControlConfigDraft,
): AccessControlState {
  return {
    backend: "iptables",
    policyPath: MOCK_POLICY_PATH,
    aliasesPath: MOCK_ALIASES_PATH,
    peers: mockPeers,
    peerMap: mockPeerMap,
    aliases: draft.aliases,
    rules: draft.rules,
    compiled: buildCompiledState(draft.aliases, draft.rules),
  };
}

export function buildMockAccessControlConfigDocument(
  draft: AccessControlConfigDraft,
): AccessControlConfigDocument {
  return {
    policyPath: MOCK_POLICY_PATH,
    aliasesPath: MOCK_ALIASES_PATH,
    aliases: draft.aliases,
    rules: draft.rules,
  };
}

export const mockAccessControlState = buildMockAccessControlState(
  mockAccessControlConfigDraft,
);
