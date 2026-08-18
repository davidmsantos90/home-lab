/* oxlint-disable react/jsx-no-literals */

import { useMemo } from "react";

import {
  ListChecksIcon,
  NetworkIcon,
  PathIcon,
  ShieldCheckIcon,
  SirenIcon,
} from "@phosphor-icons/react";
import {
  HvCard,
  HvCardContent,
  HvContainer,
  HvIconContainer,
  HvLoadingContainer,
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
import StatCard from "../components/common/StatCard";
import SectionCard from "../components/common/SectionCard";
import Header from "../components/home/Header";
import RulesTable from "../components/home/RulesTable";
import PeersTable from "../components/home/PeersTable";
import CatalogTags from "../components/common/CatalogTags";

export default function HomePage() {
  const { state, loading, error } =
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


  return (
    <HvContainer className="flex flex-col gap-6 py-6">
      <Header />

      {error != null && (
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

      <HvLoadingContainer className="flex flex-col gap-sm" opacity={1} hidden={!loading || state != null} label="Loading access-control state">
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          <StatCard
            label="Peers"
            value={summary?.peers ?? 0}
            helper="Live wg-easy inventory"
            icon={<NetworkIcon />}
          />
          <StatCard
            label="Rules"
            value={summary?.rules ?? 0}
            helper="Logical policy rows"
            icon={<ShieldCheckIcon />}
          />
          <StatCard
            label="ipsets"
            value={summary?.ipsets ?? 0}
            helper="Selector sets for grouped targets"
            icon={<NetworkIcon />}
          />
          <StatCard
            label="Compiled rules"
            value={summary?.compiledRules ?? 0}
            helper="iptables statements"
            icon={<ShieldCheckIcon />}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard
            title="Alias catalog"
            description="Peers, hosts, named groups, and services used by the policy model."
            icon={<HvIconContainer size="sm">
              <ListChecksIcon weight="duotone" />
            </HvIconContainer>}
          >
            <div className="flex flex-col gap-4">
              <CatalogTags
                title={`Peers (${summary?.peers ?? 0})`}
                tags={Object.entries(state?.peers ?? {})}
                computeTagLabel={([_, details]) => `${details.name} → ${details.ipv4Address}`}
              />

              <CatalogTags
                title={`Hosts (${summary?.hosts ?? 0})`}
                tags={Object.entries(state?.aliases.hosts ?? {})}
                computeTagLabel={([host, addresses]) => `${host} → ${addresses.join(", ")}`}
              />

              <CatalogTags
                title={`Groups (${summary?.groups ?? 0})`}
                tags={Object.entries(state?.aliases.groups ?? {})}
                computeTagLabel={([group, members]) => `${group} → ${members.join(", ")}`}
              />

              <CatalogTags
                title={`Services (${summary?.services ?? 0})`}
                tags={Object.entries(state?.aliases.services ?? {})}
                computeTagLabel={([service, entries]) => `${service} (${entries.length})`}
              />
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
          <RulesTable />
        </SectionCard>

        <SectionCard
          title="Compiled preview"
          description="These are the generated iptables statements and selector sets the compiler will apply."
          icon={<HvIconContainer size="sm">
            <NetworkIcon weight="duotone" />
          </HvIconContainer>}
        >
          <div className="flex flex-col gap-4">
            {/* <div className="flex flex-col gap-2">
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
            </div> */}

            <div className="flex flex-col gap-2">
              <HvTypography variant="body" className="uppercase tracking-wide text-xs">
                iptables preview
              </HvTypography>
              <div className="overflow-x-auto rounded-md b b-neutral p-4">
                <pre className="m-0 whitespace-pre-wrap text-md leading-6">
                  {(state?.compiled.iptables ?? []).map((command) => command.join(" ")).join("\n")}
                </pre>
              </div>
            </div>
          </div>
        </SectionCard>
      </HvLoadingContainer>
    </HvContainer>
  );
}
