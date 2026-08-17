import createClient from "openapi-fetch";

import type { components, paths } from "./openapi-types";

export const ACCESS_CONTROL_API_URL =
  import.meta.env.VITE_ACCESS_CONTROL_API_URL ??
  (import.meta.env.DEV ? "http://127.0.0.1:8787" : "/");

export type AccessControlState = components["schemas"]["AccessControlState"];
export type AccessControlInventory = components["schemas"]["AccessControlInventory"];
export type AccessControlAliasCatalog = components["schemas"]["AccessControlAliasCatalog"];
export type AccessControlRule = components["schemas"]["AccessControlRule"];
export type AccessControlCompiledState = components["schemas"]["AccessControlCompiledState"];
export type AccessControlConfigDraft = components["schemas"]["AccessControlConfigDraft"];
export type AccessControlConfigDocument = components["schemas"]["AccessControlConfigDocument"];
export type AccessControlMutationResult = components["schemas"]["AccessControlMutationResult"];

export const accessControlClient = createClient<paths>({
  baseUrl: ACCESS_CONTROL_API_URL,
});

function getErrorMessage(label: string, error: unknown) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (error && typeof error === "object") {
    if ("message" in error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return `Failed to load ${label}`;
    }
  }
  return `Failed to load ${label}`;
}

async function unwrapResponse<TData, TError>(
  promise: Promise<{ data?: TData; error?: TError; response: Response }>,
  label: string,
): Promise<TData> {
  const { data, error, response } = await promise;
  if (error || !data) {
    throw new Error(getErrorMessage(label, error ?? response.statusText));
  }
  return data;
}

export function getAccessControlState(signal?: AbortSignal) {
  return unwrapResponse(
    accessControlClient.GET("/api/state", { signal }),
    "access-control state",
  );
}

export function getAccessControlInventory(signal?: AbortSignal) {
  return unwrapResponse(
    accessControlClient.GET("/api/inventory", { signal }),
    "access-control inventory",
  );
}

export function getAccessControlAliases(signal?: AbortSignal) {
  return unwrapResponse(
    accessControlClient.GET("/api/aliases", { signal }),
    "access-control aliases",
  );
}

export function getAccessControlPolicies(signal?: AbortSignal) {
  return unwrapResponse(
    accessControlClient.GET("/api/policies", { signal }),
    "access-control policies",
  );
}

export function getAccessControlConfig(signal?: AbortSignal) {
  return unwrapResponse(
    accessControlClient.GET("/api/config", { signal }),
    "access-control config",
  );
}

export function putAccessControlConfig(body: AccessControlConfigDraft) {
  return unwrapResponse(
    accessControlClient.PUT("/api/config", {
      body,
    }),
    "access-control config save",
  );
}

export function previewAccessControlConfig(body: AccessControlConfigDraft) {
  return unwrapResponse(
    accessControlClient.POST("/api/preview", {
      body,
    }),
    "access-control preview",
  );
}

export function applyAccessControlConfig(body: AccessControlConfigDraft) {
  return unwrapResponse(
    accessControlClient.POST("/api/config/apply", {
      body,
    }),
    "access-control apply",
  );
}
