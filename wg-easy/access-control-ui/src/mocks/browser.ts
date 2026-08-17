import { setupWorker } from "msw/browser";

import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);

let startPromise: Promise<unknown> | null = null;

export async function startAccessControlMocks() {
  if (typeof window === "undefined") {
    return;
  }

  if (!startPromise) {
    startPromise = worker.start({
      onUnhandledRequest: "bypass",
    });
  }

  await startPromise;
}
