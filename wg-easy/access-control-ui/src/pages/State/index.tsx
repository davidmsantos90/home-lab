/* oxlint-disable react/jsx-no-literals */

import { FileText } from "@phosphor-icons/react";
import {
  HvCard,
  HvCardContent,
  HvCardHeader,
  HvTypography,
} from "@hitachivantara/uikit-react-core";

import { useAccessControlState } from "../../lib/useAccessControlState";

export default function StatePage() {
  const { state, loading, error, lastUpdated } = useAccessControlState();

  return (
    <div className="flex flex-col gap-6 py-6">
      <HvTypography variant="title1">Raw state</HvTypography>
      <HvTypography variant="body" className="text-slate-500">
        Machine-readable snapshot returned by the access-control API.
      </HvTypography>

      {(loading || error || lastUpdated) && (
        <HvCard>
          <HvCardHeader
            title="Snapshot status"
            icon={<FileText size={20} weight="duotone" />}
          />
          <HvCardContent className="flex flex-col gap-2">
            {loading && <HvTypography variant="body">Loading...</HvTypography>}
            {error && <HvTypography variant="body">{error}</HvTypography>}
            {lastUpdated && (
              <HvTypography variant="body">Last updated: {lastUpdated}</HvTypography>
            )}
          </HvCardContent>
        </HvCard>
      )}

      <HvCard>
        <HvCardContent>
          <pre className="m-0 whitespace-pre-wrap text-sm leading-6">
            {state ? JSON.stringify(state, null, 2) : "No state loaded yet."}
          </pre>
        </HvCardContent>
      </HvCard>
    </div>
  );
}
