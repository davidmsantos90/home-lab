import { useMemo, useState } from "react";

import {
  HvButton,
  HvDialog,
  HvDialogActions,
  HvDialogContent,
  HvDialogTitle,
  HvInput,
  HvTable,
  HvTableBody,
  HvTableCell,
  HvTableContainer,
  HvTableHead,
  HvTableRow,
  HvTag,
  useHvSnackbar,
} from "@hitachivantara/uikit-react-core";

import { putAccessControlConfig, type AccessControlRule } from "../../api/client";
import { useAccessControlState } from "../../lib/useAccessControlState";

type RuleFormState = {
  source: string;
  destination: string;
  service: string;
  protocol: string;
  port: number;
  action: string;
  comment: string;
};

function formatSelector(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (typeof value === "string" && value.trim()) return value;
  return "—";
}

function selectorToField(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : "";
}

function selectorFromField(value: string): string | string[] | undefined {
  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return parts;
}

function formatService(rule: AccessControlRule) {
  if (rule.service) return formatSelector(rule.service);
  return `${rule.protocol ?? "any"}/${rule.port ?? "any"}`;
}

function toFormState(rule?: AccessControlRule): RuleFormState {
  return {
    source: selectorToField(rule?.source ?? rule?.source_group),
    destination: selectorToField(rule?.destination ?? rule?.destination_group),
    service: selectorToField(rule?.service),
    protocol: typeof rule?.protocol === "string" ? rule.protocol : "",
    port: typeof rule?.port === "number" ? rule.port : 0,
    action: typeof rule?.action === "string" ? rule.action : "allow",
    comment: typeof rule?.comment === "string" ? rule.comment : "",
  };
}

function toRule(form: RuleFormState): AccessControlRule {
  const action = form.action.trim();
  if (!action) throw new Error("Action is required.");

  const source = selectorFromField(form.source);
  const destination = selectorFromField(form.destination);
  if (!source) throw new Error("Source is required.");
  if (!destination) throw new Error("Destination is required.");

  const next: AccessControlRule = {
    source,
    destination,
    action,
  };

  const service = selectorFromField(form.service);
  const protocol = form.protocol.trim();
  const port = form.port;
  const comment = form.comment.trim();

  if (service) next.service = service;
  if (protocol) next.protocol = protocol;
  if (port) next.port = port;
  if (comment) next.comment = comment;

  return next;
}

const RulesTable = () => {
  const { state, reload } = useAccessControlState();
  const { enqueueSnackbar } = useHvSnackbar();
  const [mode, setMode] = useState<"add" | "edit" | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form, setForm] = useState<RuleFormState>(toFormState());
  const [saving, setSaving] = useState(false);

  const rules = useMemo(() => state?.rules ?? [], [state?.rules]);

  const openAdd = () => {
    setMode("add");
    setEditingIndex(null);
    setForm(toFormState());
  };

  const openEdit = (rule: AccessControlRule, index: number) => {
    setMode("edit");
    setEditingIndex(index);
    setForm(toFormState(rule));
  };

  const closeDialog = () => {
    if (!saving) {
      setMode(null);
      setEditingIndex(null);
    }
  };

  const setField = (key: keyof RuleFormState, value: string) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const save = async () => {
    if (!state || saving || mode == null) return;
    setSaving(true);
    try {
      const nextRule = toRule(form);
      const nextRules = [...rules];
      if (mode === "add") nextRules.push(nextRule);
      else {
        if (editingIndex == null) throw new Error("Missing row index.");
        nextRules[editingIndex] = nextRule;
      }

      await putAccessControlConfig({
        aliases: state.aliases,
        rules: nextRules,
      });
      enqueueSnackbar(mode === "add" ? "Rule added." : "Rule updated.", { variant: "success" });
      closeDialog();
      reload();
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <HvButton variant="primaryGhost" disabled={!state || saving} onClick={openAdd}>
          Add rule
        </HvButton>
      </div>

      <HvTableContainer className="overflow-x-auto">
        <HvTable>
          <HvTableHead>
            <HvTableRow>
              <HvTableCell>Source</HvTableCell>
              <HvTableCell>Destination</HvTableCell>
              <HvTableCell>Service</HvTableCell>
              <HvTableCell align="center">Action</HvTableCell>
              <HvTableCell>Comment</HvTableCell>
              <HvTableCell align="center">Row actions</HvTableCell>
            </HvTableRow>
          </HvTableHead>
          <HvTableBody>
            {rules.map((rule, index) => (
              <HvTableRow key={`${index}-${rule.action}`}>
                <HvTableCell>{formatSelector(rule.source ?? rule.source_group)}</HvTableCell>
                <HvTableCell>{formatSelector(rule.destination ?? rule.destination_group)}</HvTableCell>
                <HvTableCell>{formatService(rule)}</HvTableCell>
                <HvTableCell align="center">
                  <HvTag
                    label={rule.action.toUpperCase()}
                    color={rule.action === "allow" ? "positiveSubtle" : "negativeSubtle"}
                    size="sm"
                  />
                </HvTableCell>
                <HvTableCell>{rule.comment ?? "—"}</HvTableCell>
                <HvTableCell align="center">
                  <HvButton
                    variant="secondarySubtle"
                    disabled={saving}
                    onClick={() => {
                      openEdit(rule, index);
                    }}
                  >
                    Edit
                  </HvButton>
                </HvTableCell>
              </HvTableRow>
            ))}
            {rules.length === 0 && (
              <HvTableRow>
                <HvTableCell colSpan={6}>No rules found.</HvTableCell>
              </HvTableRow>
            )}
          </HvTableBody>
        </HvTable>
      </HvTableContainer>

      <HvDialog open={mode != null} onClose={closeDialog} fullWidth maxWidth="md">
        <HvDialogTitle>{mode === "add" ? "Add rule" : "Edit rule"}</HvDialogTitle>
        <HvDialogContent className="grid gap-3 sm:grid-cols-2">
          <HvInput
            label="Source"
            placeholder="peer or group (comma-separated supported)"
            value={form.source}
            onChange={(_event, value) => {
              setField("source", value);
            }}
          />
          <HvInput
            label="Destination"
            placeholder="peer or group (comma-separated supported)"
            value={form.destination}
            onChange={(_event, value) => {
              setField("destination", value);
            }}
          />
          <HvInput
            label="Service"
            placeholder="service alias"
            value={form.service}
            onChange={(_event, value) => {
              setField("service", value);
            }}
          />
          <HvInput
            label="Action"
            placeholder="allow or deny"
            value={form.action}
            onChange={(_event, value) => {
              setField("action", value);
            }}
          />
          <HvInput
            label="Protocol"
            placeholder="tcp / udp"
            value={form.protocol}
            onChange={(_event, value) => {
              setField("protocol", value);
            }}
          />
          <HvInput
            type="number"
            label="Port"
            placeholder="53"
            value={form.port}
            onChange={(_event, value) => {
              setField("port", value);
            }}
          />
          <div className="sm:col-span-2">
            <HvInput
              label="Comment"
              value={form.comment}
              onChange={(_event, value) => {
                setField("comment", value);
              }}
            />
          </div>
        </HvDialogContent>
        <HvDialogActions>
          <HvButton variant="secondaryGhost" disabled={saving} onClick={closeDialog}>
            Cancel
          </HvButton>
          <HvButton variant="primary" disabled={saving} onClick={save}>
            {saving ? "Saving..." : mode === "add" ? "Add rule" : "Save changes"}
          </HvButton>
        </HvDialogActions>
      </HvDialog>
    </div>
  );
};

export default RulesTable;
