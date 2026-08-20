import { useCallback, useMemo, useRef, useState, type FC } from "react";
import {
  HvButton,
  HvDialog,
  HvDialogActions,
  HvDialogContent,
  HvDialogTitle,
  HvInput,
  type HvDialogProps,
} from "@hitachivantara/uikit-react-core";

import type { AccessControlRule } from "../../api/apiSchemas";
import SelectDestination from "../form/SelectDestination";
import SelectService from "../form/SelectService";
import SelectSource from "../form/SelectSource";
import SelectAction from "../form/SelectAction";
import useForm from "../../hooks/useForm";

type Action = AccessControlRule["action"] | null;
type Protocol = AccessControlRule["protocol"];
interface RuleFormState extends Omit<AccessControlRule, "action"> {
  action: Action;
};

export const toFormState = (rule?: AccessControlRule): RuleFormState => {
  const toArrayValue = (value: string | string[] | undefined) => {
    const isArray = Array.isArray(value);
    if (value == null || (isArray && value.length === 0)) return [];

    return (isArray ? value : [value]).filter(Boolean);
  };

  const source = toArrayValue(rule?.source);
  const destination = toArrayValue(rule?.destination);

  const action = typeof rule?.action === "string" ? rule.action : null;
  const comment = typeof rule?.comment === "string" ? rule.comment : "";
  
  const service = toArrayValue(rule?.service);
  const protocol = typeof rule?.protocol === "string" ? rule.protocol : undefined;
  const port =
    typeof rule?.port === "number"
      ? rule.port
      : Number(rule?.port) || undefined;

  return {
    source,
    destination,
    service,
    protocol: service.length === 0 ? protocol : undefined,
    port: service.length === 0 ? port : undefined,
    action,
    comment
  };
};

function toRule(formData: FormData): AccessControlRule {
  const getArray = (name: string)  => {
    const value = formData.get(name);
    if (typeof value !== "string") return [];

    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];
      
      return parsed.filter((item) => typeof item === "string");
    } catch {
      return [];
    }
  };

  const action = formData.get("action") as Action;
  if (!action) throw new Error("Action is required.");

  const source = getArray("source");
  if (source.length === 0) throw new Error("Source is required.");

  const destination = getArray("destination");
  if (destination.length === 0) throw new Error("Destination is required.");

  const next: AccessControlRule = {
    source,
    destination,
    action,
    comment: formData.get("comment") as string,
  };

  const service = getArray("service");
  if (service.length > 0) next.service = service;
  else {
    next.protocol = formData.get("protocol") as Protocol;
    next.port = Number(formData.get("port")) || 0;
  }

  return next;
}

interface Props extends Omit<HvDialogProps, "onClose" | "onSubmit"> {
  rule?: AccessControlRule;

  labels: {
    title: string;
    onClose: string;
    onSubmit: string;
  };

  onClose?: () => void;
  onSubmit?: (rule: AccessControlRule) => void;
}

const RuleDialog: FC<Props> = (props) => {
  const { labels, rule, onClose, onSubmit: onSubmitProp, ...others } = props;

  const { form, isDirty, setField, getField } = useForm<RuleFormState>(
    toFormState(rule),
  );
  const hasService = useMemo(() => {
    const service = getField("service");

    return Array.isArray(service) && service.length > 0;
  }, [getField]);

  const hasPort = useMemo(() => {
    const port = getField("port");

    return typeof port === "number";
  }, [getField]);

  const hasProtocol = useMemo(() => {
    const protocol = getField("protocol");

    return typeof protocol === "string" && protocol.length > 0;
  }, [getField]);

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      onSubmitProp?.(toRule(new FormData(event.currentTarget)));
      onClose?.();
    },
    [onSubmitProp, onClose],
  );

  return (
    <HvDialog
      open
      fullWidth
      maxWidth="md"
      onClose={onClose}

      {...others}
    >
      <HvDialogTitle>{labels.title}</HvDialogTitle>
      <HvDialogContent>
        <form
          id="rule-form"
          onSubmit={onSubmit}
          className="grid gap-sm sm:grid-cols-4"
        >
          <SelectSource
            className="sm:col-span-2"
            defaultValue={form.source}
            onChange={(source) => setField("source", source)}
          />
          <SelectDestination
            className="sm:col-span-2"
            defaultValue={form.destination}
            onChange={(destination) => setField("destination", destination)}
          />

          <SelectAction
            className="sm:col-span-1"
            defaultValue={form.action}
            onChange={(action) => setField("action", action)}
          />

          <HvInput
            className="sm:col-span-3"
            label="Comment"
            name="comment"
            value={form.comment}
            onChange={(_, value) => {
              setField("comment", value);
            }}
          />

          <SelectService
            className="sm:col-span-4 mt-xs"
            disabled={hasPort || hasProtocol}
            defaultValue={form.service}
            onChange={(service) => setField("service", service)}
          />

          <div
            className="sm:col-span-4 flex items-center gap-3"
            role="separator"
          >
            <div className="flex-1 border-t b-positive" />
            <span className="text-secondary text-sm color-positive font-bold">or</span>
            <div className="flex-1 border-t b-positive" />
          </div>

          <HvInput
            className="sm:col-span-2"
            disabled={hasService}
            label="Protocol"
            name="protocol"
            placeholder="tcp / udp"
            value={form.protocol}
            onChange={(_, value) => {
              setField("protocol", value);
            }}
          />
          <HvInput
            className="sm:col-span-2"
            disabled={hasService}
            type="number"
            label="Port"
            name="port"
            placeholder="53"
            value={form.port}
            onChange={(_, value) => {
              setField("port", value);
            }}
          />
        </form>
      </HvDialogContent>
      <HvDialogActions>
        <HvButton variant="secondaryGhost" onClick={onClose}>
          {labels.onClose}
        </HvButton>
        <HvButton
          form="rule-form"
          type="submit"
          variant="primary"
          disabled={!isDirty}
        >
          {labels.onSubmit}
        </HvButton>
      </HvDialogActions>
    </HvDialog>
  );
};

export default RuleDialog;
