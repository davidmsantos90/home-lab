/* oxlint-disable react/jsx-no-literals */

import { useMemo, type ReactNode } from "react";

import {
  ArrowClockwiseIcon,
  CopySimpleIcon,
  ListChecksIcon,
  NetworkIcon,
  ShieldCheckIcon,
  SirenIcon,
} from "@phosphor-icons/react";
import {
  HvButton,
  HvCard,
  HvCardContent,
  HvCardHeader,
  HvIconContainer,
  HvLoading,
  HvTable,
  HvTableBody,
  HvTableCell,
  HvTableContainer,
  HvTableHead,
  HvTableRow,
  HvTag,
  HvTypography,
} from "@hitachivantara/uikit-react-core";

import { useAccessControlState } from "../lib/useAccessControlState";
import type { AccessControlRule } from "../api/client";

function formatSelector(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "—";
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return "—";
}

function formatService(rule: AccessControlRule) {
  if (rule.service) {
    return formatSelector(rule.service);
  }
  const protocol = rule.protocol ?? "any";
  const port = rule.port ?? "any";
  return `${protocol}/${port}`;
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <HvCard>
      <HvCardContent className="flex flex-col gap-2">
        <HvTypography variant="body" className="text-slate-500 uppercase tracking-wide text-xs">
          {label}
        </HvTypography>
        <HvTypography variant="title1">{value}</HvTypography>
        <HvTypography variant="body" className="text-slate-500">
          {helper}
        </HvTypography>
      </HvCardContent>
    </HvCard>
  );
}

function SectionCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <HvCard>
      <HvCardHeader title={title} subheader={description} icon={icon} />
      <HvCardContent className="flex flex-col gap-4">{children}</HvCardContent>
    </HvCard>
  );
}

export default function HomePage() {
  const { apiUrl, state, loading, refreshing, error, lastUpdated, reload } =
    useAccessControlState();

  const summary = useMemo(() => {
    if (!state) {
      return null;
    }
    const aliasCatalog = state.aliases;
    const serviceEntries = Object.values(aliasCatalog.services).reduce(
      (count, entries) => count + entries.length,
      0,
    );

    return {
      peers: state.peers.length,
      rules: state.rules.length,
      ipsets: state.compiled.ipsets.length,
      groups: Object.keys(aliasCatalog.groups).length,
      hosts: Object.keys(aliasCatalog.hosts).length,
      services: Object.keys(aliasCatalog.services).length,
      serviceEntries,
      compiledRules: state.compiled.iptables.length,
    };
  }, [state]);

  const canCopy = typeof navigator !== "undefined" && "clipboard" in navigator;

  return (
    <div className="flex flex-col gap-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-4">
          <div className="mt-1 flex-none">
            <HvIconContainer size="md">
              <ShieldCheckIcon weight="duotone" />
            </HvIconContainer>
          </div>
          <div className="min-w-0">
            <HvTypography variant="title1">wg-easy Access Control</HvTypography>
            <HvTypography variant="body" className="text-slate-500">
              React + UI Kit dashboard for live peer discovery, alias catalogs,
              policy rules, and compiled firewall previews. Use the Editor
              page to preview, save, and apply JSON drafts.
            </HvTypography>
            <div className="mt-3 flex flex-wrap gap-2">
              <HvTag label={state?.backend ?? "backend: —"} type="semantic" size="sm" />
              <HvTag
                label={"API " + apiUrl}
                type="categorical"
                size="sm"
              />
              <HvTag
                label={lastUpdated ? "updated " + lastUpdated : "not refreshed yet"}
                type="categorical"
                size="sm"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <HvButton
            variant="primaryGhost"
            startIcon={<HvIconContainer size="sm">
              <ArrowClockwiseIcon />
            </HvIconContainer>}
            onClick={reload}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </HvButton>
          <HvButton
            variant="primaryGhost"
            startIcon={<HvIconContainer size="sm">
              <CopySimpleIcon />
            </HvIconContainer>}
            disabled={!canCopy}
            onClick={async () => {
              await navigator.clipboard.writeText(apiUrl);
            }}
          >
            Copy API URL
          </HvButton>
        </div>
      </div>

      {error && (
        <HvCard>
          <HvCardContent className="flex items-start gap-3">
            <HvIconContainer size="md">
              <SirenIcon weight="duotone" />
            </HvIconContainer>
            <div>
              <HvTypography variant="title3">Backend error</HvTypography>
              <HvTypography variant="body" className="text-slate-500">
                {error}
              </HvTypography>
            </div>
          </HvCardContent>
        </HvCard>
      )}

      {loading && !state ? (
        <HvCard>
          <HvCardContent className="flex items-center justify-center py-10">
            <HvLoading label="Loading access-control state" />
          </HvCardContent>
        </HvCard>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Peers"
              value={summary?.peers ?? 0}
              helper="Live wg-easy inventory"
            />
            <StatCard
              label="Rules"
              value={summary?.rules ?? 0}
              helper="Logical policy rows"
            />
            <StatCard
              label="Compiled rules"
              value={summary?.compiledRules ?? 0}
              helper="iptables statements"
            />
            <StatCard
              label="ipsets"
              value={summary?.ipsets ?? 0}
              helper="Selector sets for grouped targets"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard
              title="Live peers"
              description="Names come from wg-easy and refresh automatically every 30 seconds."
              icon={<HvIconContainer size="sm">
                <NetworkIcon weight="duotone" />
              </HvIconContainer>}
            >
              <HvTableContainer className="overflow-x-auto">
                <HvTable>
                  <HvTableHead>
                    <HvTableRow>
                      <HvTableCell>Name</HvTableCell>
                      <HvTableCell>IPv4</HvTableCell>
                    </HvTableRow>
                  </HvTableHead>
                  <HvTableBody>
                    {(state?.peers ?? []).map((peer) => (
                      <HvTableRow key={peer.name}>
                        <HvTableCell>{peer.name}</HvTableCell>
                        <HvTableCell>{peer.ipv4Address}</HvTableCell>
                      </HvTableRow>
                    ))}
                    {(state?.peers ?? []).length === 0 && (
                      <HvTableRow>
                        <HvTableCell colSpan={2}>No peers found.</HvTableCell>
                      </HvTableRow>
                    )}
                  </HvTableBody>
                </HvTable>
              </HvTableContainer>
            </SectionCard>

            <SectionCard
              title="Alias catalog"
              description="Named groups, hosts, and services used by the policy model."
              icon={<HvIconContainer size="sm">
                <ListChecksIcon weight="duotone" />
              </HvIconContainer>}
            >
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <HvTypography variant="body" className="uppercase tracking-wide text-xs">
                    Groups ({summary?.groups ?? 0})
                  </HvTypography>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(state?.aliases.groups ?? {}).map((group) => (
                      <HvTag key={group} label={group} type="categorical" size="sm" />
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <HvTypography variant="body" className="uppercase tracking-wide text-xs">
                    Hosts ({summary?.hosts ?? 0})
                  </HvTypography>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(state?.aliases.hosts ?? {}).map(([host, addresses]) => (
                      <HvTag
                        key={host}
                        label={`${host} → ${addresses.join(", ")}`}
                        type="categorical"
                        size="sm"
                      />
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <HvTypography variant="body" className="uppercase tracking-wide text-xs">
                    Services ({summary?.services ?? 0}, {summary?.serviceEntries ?? 0} entries)
                  </HvTypography>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(state?.aliases.services ?? {}).map(([service, entries]) => (
                      <HvTag
                        key={service}
                        label={`${service} (${entries.length})`}
                        type="categorical"
                        size="sm"
                      />
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>

          <SectionCard
            title="Policy rules"
            description="The compiler evaluates these logical rules into deterministic firewall state."
            icon={<HvIconContainer size="sm">
              <ShieldCheckIcon weight="duotone" />
            </HvIconContainer>}
          >
            <HvTableContainer className="overflow-x-auto">
              <HvTable>
                <HvTableHead>
                  <HvTableRow>
                    <HvTableCell>Source</HvTableCell>
                    <HvTableCell>Destination</HvTableCell>
                    <HvTableCell>Service</HvTableCell>
                    <HvTableCell>Action</HvTableCell>
                    <HvTableCell>Comment</HvTableCell>
                  </HvTableRow>
                </HvTableHead>
                <HvTableBody>
                  {(state?.rules ?? []).map((rule) => (
                    <HvTableRow
                      key={[
                        formatSelector(rule.source ?? rule.source_group),
                        formatSelector(rule.destination ?? rule.destination_group),
                        formatService(rule),
                        rule.action,
                        rule.comment ?? "",
                      ].join("|")}
                    >
                      <HvTableCell>{formatSelector(rule.source ?? rule.source_group)}</HvTableCell>
                      <HvTableCell>
                        {formatSelector(rule.destination ?? rule.destination_group)}
                      </HvTableCell>
                      <HvTableCell>{formatService(rule)}</HvTableCell>
                      <HvTableCell>
                        <HvTag label={rule.action.toUpperCase()} type="semantic" size="sm" />
                      </HvTableCell>
                      <HvTableCell>{rule.comment ?? "—"}</HvTableCell>
                    </HvTableRow>
                  ))}
                  {(state?.rules ?? []).length === 0 && (
                    <HvTableRow>
                      <HvTableCell colSpan={5}>No rules found.</HvTableCell>
                    </HvTableRow>
                  )}
                </HvTableBody>
              </HvTable>
            </HvTableContainer>
          </SectionCard>

          <SectionCard
            title="Compiled preview"
            description="These are the generated iptables statements and selector sets the compiler will apply."
            icon={<HvIconContainer size="sm">
              <NetworkIcon weight="duotone" />
            </HvIconContainer>}
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <HvTypography variant="body" className="uppercase tracking-wide text-xs">
                  ipsets
                </HvTypography>
                <div className="flex flex-col gap-2">
                  {(state?.compiled.ipsets ?? []).map((entry) => (
                    <HvCard key={entry.name}>
                      <HvCardContent className="flex flex-col gap-1">
                        <HvTypography variant="title3">{entry.name}</HvTypography>
                        <HvTypography variant="body" className="text-slate-500">
                          {entry.members.join(", ")}
                        </HvTypography>
                      </HvCardContent>
                    </HvCard>
                  ))}
                  {(state?.compiled.ipsets ?? []).length === 0 && (
                    <HvTypography variant="body" className="text-slate-500">
                      No ipsets required for the current policy.
                    </HvTypography>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <HvTypography variant="body" className="uppercase tracking-wide text-xs">
                  iptables preview
                </HvTypography>
                <div className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-4">
                  <pre className="m-0 whitespace-pre-wrap text-sm leading-6">
                    {(state?.compiled.iptables ?? []).map((command) => command.join(" ")).join("\n")}
                  </pre>
                </div>
              </div>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
