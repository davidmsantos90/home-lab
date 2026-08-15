import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ACCESS_CONTROL_API_URL,
  fetchAccessControlState,
  type AccessControlState,
} from "./access-control-api";

const REFRESH_INTERVAL_MS = 30_000;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function useAccessControlState() {
  const [state, setState] = useState<AccessControlState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    try {
      const next = await fetchAccessControlState(signal);
      setState(next);
      setError(null);
      setLastUpdated(new Date().toISOString());
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = window.setInterval(() => {
      load();
    }, REFRESH_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);

  return useMemo(
    () => ({
      apiUrl: ACCESS_CONTROL_API_URL,
      state,
      loading,
      refreshing,
      error,
      lastUpdated,
      reload: () => {
        load();
      },
    }),
    [error, lastUpdated, load, loading, refreshing, state],
  );
}
