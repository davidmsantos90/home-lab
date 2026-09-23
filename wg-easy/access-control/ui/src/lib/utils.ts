import type {
  AccessControlRuleEditor,
} from "../api/apiSchemas";

export function formatSelector(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (typeof value === "string" && value.trim()) return value;

  return "—";
}

export function formatService(rule: AccessControlRuleEditor) {
  if (rule.services.length > 0) {
    return rule.services
      .map((service) => service.name ?? service.entries
        .map((entry) => `${entry.protocol} / ${entry.port}`)
        .join(", "))
      .join(", ");
  }

  return "—";
}
