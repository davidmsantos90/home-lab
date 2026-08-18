import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ACCESS_CONTROL_API_URL,
  getAccessControlState,
  type AccessControlState,
} from "../api/client";

const REFRESH_INTERVAL_MS = 30_000;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
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
      const nextState = await getAccessControlState(signal);
      setState(nextState);
      setError(null);
      setLastUpdated(new Date().toISOString());
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
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
