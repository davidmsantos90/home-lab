import type { PropsWithChildren } from "react";
import { HvProvider } from "@hitachivantara/uikit-react-core";

import cyberpunkTheme from "../themes/cyberpunk";

export default function CyberpunkThemeProvider({ children }: PropsWithChildren) {
  return (
    <HvProvider colorMode="dark" theme={cyberpunkTheme}>
      {children}
    </HvProvider>
  );
}
