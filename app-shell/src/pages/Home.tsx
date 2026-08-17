/* oxlint-disable react/jsx-no-literals */

import { ShieldCheckIcon } from "@phosphor-icons/react";
import { HvCard, HvCardContent, HvIconContainer, HvTag, HvTypography } from "@hitachivantara/uikit-react-core";

import { getRuntimeConfig } from "../lib/runtime-config";

export default function HomePage() {
  const config = getRuntimeConfig();
  const moduleCount = Object.keys(config.apps).length;
  const menuCount = config.menu?.length ?? 0;
  const viewCount = config.mainPanel?.views?.length ?? 0;

  return (
    <div className="flex flex-col gap-6 py-6">
      <div className="flex items-start gap-4">
        <HvIconContainer size="md">
          <ShieldCheckIcon weight="duotone" />
        </HvIconContainer>
        <div className="flex flex-col gap-2">
          <HvTypography variant="title1">{config.name ?? "Home Lab Shell"}</HvTypography>
          <HvTypography variant="body" className="text-slate-500">
            Runtime launcher for anything you choose to expose through the App Shell config.
          </HvTypography>
          <div className="flex flex-wrap gap-2">
            <HvTag label={`modules ${moduleCount}`} type="categorical" size="sm" />
            <HvTag label={`menu ${menuCount}`} type="categorical" size="sm" />
            <HvTag label={`views ${viewCount}`} type="categorical" size="sm" />
          </div>
        </div>
      </div>

      <HvCard>
        <HvCardContent className="flex flex-col gap-2">
          <HvTypography variant="title3">Runtime config</HvTypography>
          <HvTypography variant="body" className="text-slate-500">
            Edit app-shell.config.json by hand to change the shell's modules, menus, and views.
          </HvTypography>
        </HvCardContent>
      </HvCard>
    </div>
  );
}
