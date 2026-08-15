import type { RouteObject } from "react-router-dom";
import type { NavigationData } from "@hitachivantara/uikit-react-core";

export const appRoutes: RouteObject[] = [
  { index: true, path: "/", lazy: () => import("./pages/Home") },
  { path: "state", lazy: () => import("./pages/State") },
];

export const navigationData: NavigationData[] = [
  { id: "dashboard", label: "Dashboard", path: "/" },
  { id: "state", label: "Raw state", path: "state" },
];
