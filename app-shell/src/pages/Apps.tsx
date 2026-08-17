import { HvCard, HvCardContent, HvTypography } from "@hitachivantara/uikit-react-core";

export default function AppsPage() {
  return (
    <div className="flex flex-col gap-6 py-6">
      <HvCard>
        <HvCardContent className="flex flex-col gap-2">
          <HvTypography variant="title1">Shell configuration</HvTypography>
          <HvTypography variant="body" className="text-slate-500">
            The published app menu and routes come from the external App Shell config file.
          </HvTypography>
        </HvCardContent>
      </HvCard>
    </div>
  );
}
