import { useCallback, useMemo, type FC } from "react";
import {
  HvButton,
  HvDialog,
  HvDialogActions,
  HvDialogContent,
  HvDialogTitle,
  HvInput,
  HvSwitch,
  HvTypography,
  type HvDialogProps,
} from "@hitachivantara/uikit-react-core";

import { useGetAccessControlServices } from "../../api/apiComponents";
import type {
  AccessControlRuleEditor,
  AccessControlRuleService,
} from "../../api/apiSchemas";
import useForm from "../../hooks/useForm";
import InputPort from "../form/InputPort";
import SelectAction from "../form/SelectAction";
import SelectDestination from "../form/SelectDestination";
import SelectProtocol from "../form/SelectProtocol";
import SelectService from "../form/SelectService";
import SelectSource from "../form/SelectSource";
import Separator from "../common/Separator";
import type { NullableAccessControlAction, RuleFormState } from "../../types/accessControl";
import Service from "../common/Service";

export const toFormState = (rule?: AccessControlRuleEditor): RuleFormState => {
  const action: NullableAccessControlAction =
    typeof rule?.action === "string" ? rule.action : null;
  const comment = typeof rule?.comment === "string" ? rule.comment : "";
  const services = rule?.services ?? [];
  const directService = services.find((service) => service.name == null);

  const directEntry = directService?.entries[0];

  return {
    source: rule?.source ?? [],
    destination: rule?.destination ?? [],
    services,
    bidirectional: Boolean(directEntry?.bidirectional),
    protocol: directEntry?.protocol,
    port: directEntry?.port,
    action,
    comment,
  };
};

function toRule(formData: FormData, form: RuleFormState): AccessControlRuleEditor {
  const getArray = (name: string) => {
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

  const action = formData.get("action");
  if (
    action !== "allow" &&
    action !== "deny" &&
    action !== "drop" &&
    action !== "reject"
  ) {
    throw new Error("Action is required.");
  }

  const source = getArray("source");
  if (source.length === 0) throw new Error("Source is required.");

  const destination = getArray("destination");
  if (destination.length === 0) throw new Error("Destination is required.");

  const next: AccessControlRuleEditor = {
    source,
    destination,
    action,
    comment: formData.get("comment") as string,
    services: [],
  };

  const namedServices = form.services.filter((service) => service.name != null);
  if (namedServices.length > 0) {
    next.services = namedServices;
  } else {
    const protocol = formData.get("protocol");
    if (protocol !== "tcp" && protocol !== "udp") {
      throw new Error("Protocol is required.");
    }

    next.services = [{
      entries: [{
        protocol,
        port: Number(formData.get("port")) || 0,
        bidirectional: form.bidirectional,
      }],
    }];
  }

  return next;
}

interface Props extends Omit<HvDialogProps, "onClose" | "onSubmit"> {
  rule?: AccessControlRuleEditor;

  labels: {
    title: string;
    onClose: string;
    onSubmit: string;
  };

  onClose?: () => void;
  onSubmit?: (rule: AccessControlRuleEditor) => void;
}

const RuleDialog: FC<Props> = (props) => {
  const { labels, rule, onClose, onSubmit: onSubmitProp, ...others } = props;

  const { form, isDirty, setField, getField } = useForm<RuleFormState>(
    toFormState(rule),
  );
  const { data: serviceCatalog = [] } = useGetAccessControlServices({});
  const hasService = useMemo(() => {
    const services = getField("services") as AccessControlRuleService[];

    return services.some((service) => service.name != null);
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

      onSubmitProp?.(toRule(new FormData(event.currentTarget), form));
      onClose?.();
    },
    [onSubmitProp, onClose, form],
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
            defaultValue={form.action ?? undefined}
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
            defaultValue={form.services
              .filter((service) => service.name != null)
              .map((service) => service.name!)}
            onChange={(serviceNames) => {
              const selectedServices = new Map<string, AccessControlRuleService>();
              for (const service of form.services) {
                if (service.name != null) selectedServices.set(service.name, service);
              }
              setField(
                "services",
                serviceNames.map((name) => {
                  const existingService = selectedServices.get(name);
                  if (existingService) return existingService;

                  const catalogService = serviceCatalog.find(
                    (service) => service.name === name,
                  );
                  const entries = catalogService?.entries ??
                    (catalogService?.protocol && catalogService.port != null
                      ? [{
                          protocol: catalogService.protocol,
                          port: catalogService.port,
                          bidirectional: catalogService.bidirectional,
                        }]
                      : []);
                  return { name, entries };
                }),
              );
            }}
          />

          {hasService ? (
            <>
              {form.services.filter((service) => service.name != null).map((service, index) => (
                <Service
                  key={`${service.name}-${index}`}
                  value={service}
                />
              ))}
            </>
          ) : (
            <>
              <Separator />

              <SelectProtocol
                className="sm:col-span-2"
                disabled={hasService}
                defaultValue={form.protocol}
                onChange={(protocol) =>
                  setField("protocol", protocol ?? undefined)
                }
              />

              <InputPort
                className="sm:col-span-1"
                disabled={hasService}
                defaultValue={form.port}
                onChange={(port) => setField("port", port)}
              />
              <HvSwitch
                className="sm:col-span-1"
                name="bidirectional"
                label="Bidirectional"
                value="on"
                checked={form.bidirectional}
                onChange={(_, checked) => {
                  setField("bidirectional", checked);
                }}
              />
            </>
          )}
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
