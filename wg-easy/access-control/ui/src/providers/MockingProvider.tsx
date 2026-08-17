import { useEffect, type PropsWithChildren } from "react";

import { startAccessControlMocks } from "../mocks/browser";

export function MockingProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    startAccessControlMocks().catch((error) => {
      throw error;
    });
  }, []);

  return children;
}

export default MockingProvider;
