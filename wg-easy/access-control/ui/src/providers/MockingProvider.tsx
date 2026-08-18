import { FC, useEffect, type PropsWithChildren } from "react";
import { HvProvider } from "@hitachivantara/uikit-react-core";

import { startAccessControlMocks } from "../mocks/browser";
import cyberpunkTheme from "../themes/cyberpunk";

const MockingProvider: FC<PropsWithChildren> = ({ children }) => {
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    startAccessControlMocks().catch((error) => {
      throw error;
    });
  }, []);

  return (
    <HvProvider
      colorMode="dark"
      cssBaseline="scoped"
      cssTheme="scoped"
      theme={cyberpunkTheme}
    >
      {children}
    </HvProvider>
  );
};

export default MockingProvider;
