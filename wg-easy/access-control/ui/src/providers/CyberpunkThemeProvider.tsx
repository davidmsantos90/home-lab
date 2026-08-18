import type { PropsWithChildren } from "react";
import { HvProvider } from "@hitachivantara/uikit-react-core";

import cyberpunkTheme from "../themes/cyberpunk";

export function CyberpunkThemeProvider({ children }: PropsWithChildren) {
  return (
    <HvProvider colorMode="dark" cssBaseline="scoped" cssTheme="scoped" theme={cyberpunkTheme}>
      {children}
    </HvProvider>
  );
}

export default CyberpunkThemeProvider;
