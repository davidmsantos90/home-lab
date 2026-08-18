import type { FC } from "react";
import {
  ArrowClockwiseIcon,
  CopySimpleIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import {
  HvButton,
  HvIconContainer,
  HvTag,
  HvTypography,
} from "@hitachivantara/uikit-react-core";
import { useAccessControlState } from "../../lib/useAccessControlState";

const Header: FC = () => {
  const { apiUrl, state, refreshing, lastUpdated, reload } =
      useAccessControlState();

  const canCopy = typeof navigator !== "undefined" && "clipboard" in navigator;

  return (
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
  )
};

export default Header;
