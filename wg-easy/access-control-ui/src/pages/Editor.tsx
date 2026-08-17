/* oxlint-disable react/jsx-no-literals */

import { useCallback, useEffect, useMemo, useState } from "react";

import { NotePencilIcon, ShieldCheckIcon, SirenIcon } from "@phosphor-icons/react";
import {
  HvButton,
  HvCard,
  HvCardContent,
  HvCardHeader,
  HvIconContainer,
  HvLoading,
  HvTag,
  HvTextArea,
  HvTypography,
  useHvSnackbar,
} from "@hitachivantara/uikit-react-core";

import {
  ACCESS_CONTROL_API_URL,
  applyAccessControlConfig,
  getAccessControlConfig,
  previewAccessControlConfig,
  putAccessControlConfig,
  type AccessControlConfigDocument,
  type AccessControlConfigDraft,
  type AccessControlMutationResult,
} from "../api/client";

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function parseJsonText<TValue>(label: string, value: string, validator: (input: unknown) => boolean) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${getErrorMessage(error)}`, {
      cause: error,
    });
  }

  if (!validator(parsed)) {
    throw new Error(`${label} has an unexpected shape.`);
  }

  return parsed as TValue;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isConfigDraft(value: unknown): value is AccessControlConfigDraft {
  return (
    isObjectRecord(value) &&
    isObjectRecord(value.aliases) &&
    Array.isArray(value.rules)
  );
}

function CompiledPreview({ result }: { result: AccessControlMutationResult["state"] | null }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <HvCard>
          <HvCardContent className="flex flex-col gap-2">
            <HvTypography variant="body" className="uppercase tracking-wide text-xs text-slate-500">
              Rules
            </HvTypography>
            <HvTypography variant="title2">{result?.rules.length ?? 0}</HvTypography>
          </HvCardContent>
        </HvCard>
        <HvCard>
          <HvCardContent className="flex flex-col gap-2">
            <HvTypography variant="body" className="uppercase tracking-wide text-xs text-slate-500">
              Compiled iptables
            </HvTypography>
            <HvTypography variant="title2">{result?.compiled.iptables.length ?? 0}</HvTypography>
          </HvCardContent>
        </HvCard>
        <HvCard>
          <HvCardContent className="flex flex-col gap-2">
            <HvTypography variant="body" className="uppercase tracking-wide text-xs text-slate-500">
              Compiled ipsets
            </HvTypography>
            <HvTypography variant="title2">{result?.compiled.ipsets.length ?? 0}</HvTypography>
          </HvCardContent>
        </HvCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <HvCard>
          <HvCardHeader
            title="ipsets"
            subheader="Selector sets generated for grouped peers."
            icon={
              <HvIconContainer size="sm">
                <ShieldCheckIcon weight="duotone" />
              </HvIconContainer>
            }
          />
          <HvCardContent className="flex flex-col gap-3">
            {(result?.compiled.ipsets ?? []).map((entry) => (
              <div key={entry.name} className="rounded-md border border-slate-200 p-3">
                <HvTypography variant="title4">{entry.name}</HvTypography>
                <HvTypography variant="body" className="text-slate-500">
                  {entry.members.join(", ")}
                </HvTypography>
              </div>
            ))}
            {(result?.compiled.ipsets ?? []).length === 0 && (
              <HvTypography variant="body" className="text-slate-500">
                No ipsets are required for the current draft.
              </HvTypography>
            )}
          </HvCardContent>
        </HvCard>

        <HvCard>
          <HvCardHeader
            title="iptables preview"
            subheader="Firewall statements compiled from the current draft."
            icon={
              <HvIconContainer size="sm">
                <ShieldCheckIcon weight="duotone" />
              </HvIconContainer>
            }
          />
          <HvCardContent>
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-4">
              <pre className="m-0 whitespace-pre-wrap text-sm leading-6">
                {(result?.compiled.iptables ?? []).map((command) => command.join(" ")).join("\n")}
              </pre>
            </div>
          </HvCardContent>
        </HvCard>
      </div>
    </div>
  );
}

export default function EditorPage() {
  const { enqueueSnackbar } = useHvSnackbar();
  const [config, setConfig] = useState<AccessControlConfigDocument | null>(null);
  const [aliasesText, setAliasesText] = useState("");
  const [rulesText, setRulesText] = useState("");
  const [savedAliasesText, setSavedAliasesText] = useState("");
  const [savedRulesText, setSavedRulesText] = useState("");
  const [aliasesError, setAliasesError] = useState<string | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<AccessControlMutationResult["state"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"preview" | "save" | "apply" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const applyLoadedConfig = useCallback((nextConfig: AccessControlConfigDocument) => {
    const nextAliasesText = prettyJson(nextConfig.aliases);
    const nextRulesText = prettyJson(nextConfig.rules);
    setConfig(nextConfig);
    setAliasesText(nextAliasesText);
    setRulesText(nextRulesText);
    setSavedAliasesText(nextAliasesText);
    setSavedRulesText(nextRulesText);
    setAliasesError(null);
    setRulesError(null);
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const nextConfig = await getAccessControlConfig();
      applyLoadedConfig(nextConfig);
      setPreviewState(null);
      setLoadError(null);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [applyLoadedConfig]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const isDirty = useMemo(
    () => aliasesText !== savedAliasesText || rulesText !== savedRulesText,
    [aliasesText, rulesText, savedAliasesText, savedRulesText],
  );

  const buildDraft = useCallback(() => {
    const nextAliases = parseJsonText<AccessControlConfigDraft["aliases"]>(
      "Aliases",
      aliasesText,
      isObjectRecord,
    );
    const nextRules = parseJsonText<AccessControlConfigDraft["rules"]>(
      "Rules",
      rulesText,
      Array.isArray,
    );
    const nextDraft = {
      aliases: nextAliases,
      rules: nextRules,
    };
    if (!isConfigDraft(nextDraft)) {
      throw new Error("Draft payload is incomplete.");
    }
    return nextDraft;
  }, [aliasesText, rulesText]);

  const runDraftAction = useCallback(
    async (
      action: "preview" | "save" | "apply",
      request: (draft: AccessControlConfigDraft) => Promise<AccessControlMutationResult>,
      successMessage: string,
    ) => {
      setBusyAction(action);
      setAliasesError(null);
      setRulesError(null);

      let draft: AccessControlConfigDraft;
      try {
        draft = buildDraft();
      } catch (error) {
        const message = getErrorMessage(error);
        if (message.startsWith("Aliases")) {
          setAliasesError(message);
        } else if (message.startsWith("Rules")) {
          setRulesError(message);
        } else {
          setLoadError(message);
        }
        setBusyAction(null);
        return;
      }

      try {
        const result = await request(draft);
        setPreviewState(result.state);
        if (action !== "preview") {
          const nextConfig = await getAccessControlConfig();
          applyLoadedConfig(nextConfig);
        }
        setLoadError(null);
        enqueueSnackbar(successMessage, {
          variant: "success",
        });
      } catch (error) {
        const message = getErrorMessage(error);
        setLoadError(message);
        enqueueSnackbar(message, {
          variant: "error",
        });
      } finally {
        setBusyAction(null);
      }
    },
    [applyLoadedConfig, buildDraft, enqueueSnackbar],
  );

  return (
    <div className="flex flex-col gap-6 py-6">
      <HvCard>
        <HvCardContent className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="mt-1 flex-none">
              <HvIconContainer size="md">
                <NotePencilIcon weight="duotone" />
              </HvIconContainer>
            </div>
            <div className="min-w-0">
              <HvTypography variant="title1">Access-control editor</HvTypography>
              <HvTypography variant="body" className="text-slate-500">
                Edit aliases and policy JSON, preview the compiled firewall state, then save or apply the draft through the OpenAPI-backed API.
              </HvTypography>
              <div className="mt-3 flex flex-wrap gap-2">
                <HvTag label={`API ${ACCESS_CONTROL_API_URL}`} type="categorical" size="sm" />
                <HvTag
                  label={isDirty ? "draft has changes" : "draft matches persisted config"}
                  type={isDirty ? "categorical" : "semantic"}
                  size="sm"
                />
                {config && <HvTag label={config.policyPath} type="categorical" size="sm" />}
                {config && <HvTag label={config.aliasesPath} type="categorical" size="sm" />}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <HvButton
              variant="primaryGhost"
              disabled={loading || busyAction !== null}
              onClick={loadConfig}
            >
              Reload persisted config
            </HvButton>
            <HvButton
              variant="primaryGhost"
              disabled={loading || busyAction !== null || !config}
              onClick={() => {
                if (!config) {
                  return;
                }
                applyLoadedConfig(config);
                setPreviewState(null);
                setLoadError(null);
              }}
            >
              Reset draft
            </HvButton>
            <HvButton
              variant="primaryGhost"
              disabled={loading || busyAction !== null}
              onClick={() =>
                runDraftAction("preview", previewAccessControlConfig, "Compiled preview updated.")
              }
            >
              {busyAction === "preview" ? "Previewing..." : "Preview"}
            </HvButton>
            <HvButton
              variant="primaryGhost"
              disabled={loading || busyAction !== null}
              onClick={() =>
                runDraftAction("save", putAccessControlConfig, "Draft saved to disk.")
              }
            >
              {busyAction === "save" ? "Saving..." : "Save"}
            </HvButton>
            <HvButton
              variant="primary"
              disabled={loading || busyAction !== null}
              onClick={() =>
                runDraftAction("apply", applyAccessControlConfig, "Draft applied to the firewall.")
              }
            >
              {busyAction === "apply" ? "Applying..." : "Apply"}
            </HvButton>
          </div>
        </HvCardContent>
      </HvCard>

      {loadError && (
        <HvCard>
          <HvCardContent className="flex items-start gap-3">
            <HvIconContainer size="md">
              <SirenIcon weight="duotone" />
            </HvIconContainer>
            <div>
              <HvTypography variant="title3">Editor error</HvTypography>
              <HvTypography variant="body" className="text-slate-500">
                {loadError}
              </HvTypography>
            </div>
          </HvCardContent>
        </HvCard>
      )}

      {loading ? (
        <HvCard>
          <HvCardContent className="flex items-center justify-center py-10">
            <HvLoading label="Loading persisted access-control config" />
          </HvCardContent>
        </HvCard>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <HvCard>
              <HvCardHeader
                title="Aliases JSON"
                subheader="Groups, hosts, and services available to the policy model."
                icon={
                  <HvIconContainer size="sm">
                    <ShieldCheckIcon weight="duotone" />
                  </HvIconContainer>
                }
              />
              <HvCardContent>
                <HvTextArea
                  value={aliasesText}
                  rows={24}
                  resizable
                  label="Aliases"
                  placeholder='{"groups":{},"hosts":{},"services":{}}'
                  status={aliasesError ? "invalid" : "standBy"}
                  statusMessage={aliasesError ?? undefined}
                  onChange={(_event, value) => {
                    setAliasesText(value);
                    if (aliasesError) {
                      setAliasesError(null);
                    }
                  }}
                />
              </HvCardContent>
            </HvCard>

            <HvCard>
              <HvCardHeader
                title="Policies JSON"
                subheader="Logical rules that will be compiled into firewall state."
                icon={
                  <HvIconContainer size="sm">
                    <ShieldCheckIcon weight="duotone" />
                  </HvIconContainer>
                }
              />
              <HvCardContent>
                <HvTextArea
                  value={rulesText}
                  rows={24}
                  resizable
                  label="Policies"
                  placeholder='[{"source":"phone","destination":"raspberry","action":"allow"}]'
                  status={rulesError ? "invalid" : "standBy"}
                  statusMessage={rulesError ?? undefined}
                  onChange={(_event, value) => {
                    setRulesText(value);
                    if (rulesError) {
                      setRulesError(null);
                    }
                  }}
                />
              </HvCardContent>
            </HvCard>
          </div>

          <HvCard>
            <HvCardHeader
              title="Compiled draft preview"
              subheader="Preview shows the state returned by the backend compiler for the current draft."
              icon={
                <HvIconContainer size="sm">
                  <ShieldCheckIcon weight="duotone" />
                </HvIconContainer>
              }
            />
            <HvCardContent>
              {previewState ? (
                <CompiledPreview result={previewState} />
              ) : (
                <HvTypography variant="body" className="text-slate-500">
                  Run Preview, Save, or Apply to inspect the compiled result for the current draft.
                </HvTypography>
              )}
            </HvCardContent>
          </HvCard>
        </>
      )}
    </div>
  );
}
