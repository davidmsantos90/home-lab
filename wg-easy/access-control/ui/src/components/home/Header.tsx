import type { FC } from "react";
import {
  ArrowClockwiseIcon,
  CopySimpleIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  HvButton,
  HvIconContainer,
  HvTag,
  HvTypography,
} from "@hitachivantara/uikit-react-core";

import { useGetAccessControlState } from "../../api/apiComponents";
import { ACCESS_CONTROL_API_URL } from "../../lib/queryClient";

const Header: FC = () => {
  const { data: state, isRefetching } = useGetAccessControlState({});
  const queryClient = useQueryClient();

  const canCopy = typeof navigator !== "undefined" && "clipboard" in navigator;

  const handleRefresh = async () => {
    await queryClient.refetchQueries({ queryKey: ["getAccessControlState"] });
  };

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
            policy rules, and compiled firewall previews. Use the Editor page to
            preview, save, and apply JSON drafts.
          </HvTypography>
          <div className="mt-3 flex flex-wrap gap-2">
            <HvTag
              label={state?.backend ?? "backend: —"}
              type="semantic"
              size="sm"
            />
            <HvTag
              label={"API " + ACCESS_CONTROL_API_URL}
              type="categorical"
              size="sm"
            />
            <HvTag
              label={"updated " + new Date().toISOString()}
              type="categorical"
              size="sm"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <HvButton
          variant="primaryGhost"
          startIcon={
            <HvIconContainer size="sm">
              <ArrowClockwiseIcon />
            </HvIconContainer>
          }
          onClick={handleRefresh}
        >
          {isRefetching ? "Refreshing..." : "Refresh"}
        </HvButton>
        <HvButton
          variant="primaryGhost"
          startIcon={
            <HvIconContainer size="sm">
              <CopySimpleIcon />
            </HvIconContainer>
          }
          disabled={!canCopy}
          onClick={async () => {
            await navigator.clipboard.writeText(ACCESS_CONTROL_API_URL);
          }}
        >
          Copy API URL
        </HvButton>
      </div>
    </div>
  );
};

export default Header;
