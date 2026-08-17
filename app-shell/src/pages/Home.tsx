import { ShieldCheckIcon } from "@phosphor-icons/react";
import { HvCard, HvCardContent, HvIconContainer, HvTypography } from "@hitachivantara/uikit-react-core";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-6 py-6">
      <div className="flex items-start gap-4">
        <HvIconContainer size="md">
          <ShieldCheckIcon weight="duotone" />
        </HvIconContainer>
        <div className="flex flex-col gap-2">
          <HvTypography variant="title1">Home Lab Shell</HvTypography>
          <HvTypography variant="body" className="text-slate-500">
            Empty App Shell container. Publish apps into it with an external config file.
          </HvTypography>
        </div>
      </div>

      <HvCard>
        <HvCardContent className="flex flex-col gap-2">
          <HvTypography variant="title3">Runtime config</HvTypography>
          <HvTypography variant="body" className="text-slate-500">
            The container loads HOME_LAB_DIR/app-shell.config.json through the generated App Shell
            runtime script.
          </HvTypography>
        </HvCardContent>
      </HvCard>
    </div>
  );
}
