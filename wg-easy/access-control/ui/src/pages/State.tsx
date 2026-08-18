/* oxlint-disable react/jsx-no-literals */

import { FileTextIcon } from "@phosphor-icons/react";
import {
  HvCard,
  HvCardContent,
  HvCardHeader,
  HvTypography,
} from "@hitachivantara/uikit-react-core";

import { useGetAccessControlState } from "../api/apiComponents";

export default function StatePage() {
  const { data: state, isLoading, error } = useGetAccessControlState({});

  return (
    <div className="flex flex-col gap-6 py-6">
      <HvTypography variant="title1">Raw state</HvTypography>
      <HvTypography variant="body" className="text-slate-500">
        Machine-readable snapshot returned by the access-control API.
      </HvTypography>

      {(isLoading || error) && (
        <HvCard>
          <HvCardHeader
            title="Snapshot status"
            icon={<FileTextIcon size={20} weight="duotone" />}
          />
          <HvCardContent className="flex flex-col gap-2">
            {isLoading && (
              <HvTypography variant="body">Loading...</HvTypography>
            )}
            {error && (
              <HvTypography variant="body">{error.payload}</HvTypography>
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
