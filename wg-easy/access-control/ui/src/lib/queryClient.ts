import { QueryClient } from "@tanstack/react-query";

export const ACCESS_CONTROL_API_URL =
  import.meta.env.VITE_ACCESS_CONTROL_API_URL ??
  (import.meta.env.DEV ? "http://127.0.0.1:8787" : "/");

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});
