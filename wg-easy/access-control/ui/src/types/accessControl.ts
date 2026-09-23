import type {
  AccessControlRuleEditor,
  AccessControlRuleService,
} from "../api/apiSchemas";

export type AccessControlAction = AccessControlRuleEditor["action"];
export type NullableAccessControlAction = AccessControlAction | null;
export type NullableProtocol = AccessControlRuleService["entries"][number]["protocol"] | undefined;
export type Protocol = NonNullable<NullableProtocol>;

export interface RuleFormState
  extends Omit<AccessControlRuleEditor, "action" | "services"> {
  action: NullableAccessControlAction;
  services: AccessControlRuleService[];
  protocol?: Protocol;
  port?: number;
  bidirectional: boolean;
}
