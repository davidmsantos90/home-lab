import { HvCard, HvCardContent, HvTypography } from "@hitachivantara/uikit-react-core";

import { getRuntimeConfig } from "../lib/runtime-config";

export default function AppsPage() {
  const config = getRuntimeConfig();
  const views = config.mainPanel?.views ?? [];

  return (
    <div className="flex flex-col gap-6 py-6">
      <HvTypography variant="title1">Shell configuration</HvTypography>
      {(config.menu?.length ?? 0) === 0 ? (
        <HvCard>
          <HvCardContent>
            <HvTypography variant="body" className="text-slate-500">
              No menu items configured yet.
            </HvTypography>
          </HvCardContent>
        </HvCard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {config.menu?.map((item) => (
            <HvCard key={item.label}>
              <HvCardContent className="flex flex-col gap-2">
                <HvTypography variant="title3">{item.label}</HvTypography>
                <HvTypography variant="body" className="text-slate-500">
                  {item.target}
                </HvTypography>
              </HvCardContent>
            </HvCard>
          ))}
        </div>
      )}

      <HvCard>
        <HvCardContent className="flex flex-col gap-2">
          <HvTypography variant="title3">Views</HvTypography>
          {views.length === 0 ? (
            <HvTypography variant="body" className="text-slate-500">
              No routes configured yet.
            </HvTypography>
          ) : (
            views.map((view) => (
              <HvTypography key={view.route} variant="body" className="text-slate-500">
                {view.route} → {view.bundle}
              </HvTypography>
            ))
          )}
        </HvCardContent>
      </HvCard>
    </div>
  );
}
