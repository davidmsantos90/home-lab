import type { AccessControlRule } from "../api/apiSchemas";

export function formatSelector(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (typeof value === "string" && value.trim()) return value;

  return "—";
}

export function formatService(rule: AccessControlRule) {
  if (rule.service) return formatSelector(rule.service);

  return `${rule.protocol ?? "any"} / ${rule.port ?? "any"}`;
}
