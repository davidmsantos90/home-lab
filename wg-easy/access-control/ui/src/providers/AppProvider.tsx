import { Suspense, type FC, type PropsWithChildren } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { HvLoading } from "@hitachivantara/uikit-react-core";

import { queryClient } from "../lib/queryClient";
import PortalProvider from "./PortalProvider";

const AppProvider: FC<PropsWithChildren> = ({ children }) => (
  <QueryClientProvider client={queryClient}>
    <Suspense fallback={<HvLoading />}>
      <PortalProvider>{children}</PortalProvider>
    </Suspense>
  </QueryClientProvider>
);

export default AppProvider;
