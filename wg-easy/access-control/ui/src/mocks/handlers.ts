import { http, HttpResponse } from "msw";

import type {
  AccessControlConfigDraft,
  AccessControlRule,
  AccessControlRuleEditor,
  AccessControlRuleEditorItem,
  AccessControlServiceSelector,
} from "../api/apiSchemas";
import {
  buildMockAccessControlConfigDocument,
  buildMockAccessControlState,
  mockAccessControlConfigDraft,
} from "../lib/mock-data";
import { ACCESS_CONTROL_API_URL } from "../lib/queryClient";

const apiUrl = (path: string) =>
  new URL(path, ACCESS_CONTROL_API_URL).toString();

let currentDraft: AccessControlConfigDraft = structuredClone(
  mockAccessControlConfigDraft,
);
let nextRuleId = 1;

function ensureRuleIds() {
  currentDraft = {
    ...currentDraft,
    rules: currentDraft.rules.map((rule) =>
      rule.id ? rule : { ...rule, id: `mock-rule-${nextRuleId++}` },
    ),
  };
}

ensureRuleIds();

function currentState() {
  return buildMockAccessControlState(currentDraft);
}

function buildMutationResult(
  draft: AccessControlConfigDraft,
  persisted: boolean,
  applied: boolean,
) {
  return {
    state: buildMockAccessControlState(draft),
    persisted,
    applied,
  };
}

async function parseDraft(request: Request) {
  const payload = await request.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    !("aliases" in payload) ||
    !("rules" in payload) ||
    !payload.aliases ||
    typeof payload.aliases !== "object" ||
    !Array.isArray(payload.rules)
  ) {
    return null;
  }
  return payload as AccessControlConfigDraft;
}

function getPeers() {
  return currentState().peers;
}

function getRules() {
  return currentState().rules;
}

function getRuleEditor(rule: AccessControlConfigDraft["rules"][number]): AccessControlRuleEditor {
  const services = (rule.service ?? []).flatMap((selector) => {
    if (typeof selector === "string") {
      return [{ name: selector, entries: getServices().find((service) => service.name === selector)?.entries ?? [] }];
    }
    if ("name" in selector) {
      return [{
        name: selector.name,
        entries: getServices().find((service) => service.name === selector.name)?.entries ?? [],
        bidirectional: selector.bidirectional,
      }];
    }
    return [{ entries: [selector] }];
  });
  return {
    source: rule.source ?? [],
    destination: rule.destination ?? [],
    action: rule.action,
    comment: rule.comment,
    services,
  };
}

function getRuleEditorItems(): AccessControlRuleEditorItem[] {
  return getRules().map((rule) => ({ id: rule.id!, rule: getRuleEditor(rule) }));
}

function ruleFromEditor(
  editor: AccessControlRuleEditor,
  id: string,
): AccessControlRule {
  return {
    id,
    source: editor.source,
    destination: editor.destination,
    action: editor.action,
    comment: editor.comment,
    service: editor.services.flatMap<AccessControlServiceSelector>((service) => {
      if (service.name) {
        return service.bidirectional
          ? [{ name: service.name, bidirectional: true }]
          : [service.name];
      }
      return service.entries;
    }),
  };
}

function getGroups() {
  return Object.entries(currentState().aliases.groups).map(
    ([name, members]) => ({ name, members }),
  );
}

function getServices() {
  return Object.entries(currentState().aliases.services).map(
    ([name, entries]) => ({ name, entries }),
  );
}

export const handlers = [
  http.get(apiUrl("/healthz"), () => HttpResponse.text("ok")),
  http.get(apiUrl("/openapi.json"), () =>
    HttpResponse.json({
      openapi: "3.0.3",
      info: {
        title: "wg-easy access control API",
        version: "1.1.0",
      },
    }),
  ),
  http.get(apiUrl("/api/openapi.json"), () =>
    HttpResponse.json({
      openapi: "3.0.3",
      info: {
        title: "wg-easy access control API",
        version: "1.1.0",
      },
    }),
  ),
  http.get(apiUrl("/api/state"), () => HttpResponse.json(currentState())),
  http.get(apiUrl("/api/config"), () =>
    HttpResponse.json(buildMockAccessControlConfigDocument(currentDraft)),
  ),
  http.put(apiUrl("/api/config"), async ({ request }) => {
    const draft = await parseDraft(request);
    if (!draft) {
      return HttpResponse.text("Request body must contain aliases and rules.", {
        status: 400,
      });
    }
    currentDraft = structuredClone(draft);
    return HttpResponse.json(buildMutationResult(currentDraft, true, false));
  }),
  http.post(apiUrl("/api/preview"), async ({ request }) => {
    const draft = await parseDraft(request);
    if (!draft) {
      return HttpResponse.text("Request body must contain aliases and rules.", {
        status: 400,
      });
    }
    return HttpResponse.json(buildMutationResult(draft, false, false));
  }),
  http.post(apiUrl("/api/config/apply"), async ({ request }) => {
    const draft = await parseDraft(request);
    if (!draft) {
      return HttpResponse.text("Request body must contain aliases and rules.", {
        status: 400,
      });
    }
    currentDraft = structuredClone(draft);
    return HttpResponse.json(buildMutationResult(currentDraft, true, true));
  }),
  http.get(apiUrl("/api/inventory"), () =>
    HttpResponse.json({
      backend: currentState().backend,
      policyPath: currentState().policyPath,
      aliasesPath: currentState().aliasesPath,
      peers: currentState().peers,
      aliases: currentState().aliases,
    }),
  ),
  http.get(apiUrl("/api/peers"), () => HttpResponse.json(getPeers())),
  http.get(apiUrl("/api/peers/:peerName"), ({ params }) => {
    const peer = getPeers().find((item) => item.name === params.peerName);
    return peer
      ? HttpResponse.json(peer)
      : HttpResponse.text("Peer not found", { status: 404 });
  }),
  http.get(apiUrl("/api/rules"), () =>
    HttpResponse.json(getRules().map((rule) => ({ id: rule.id, rule }))),
  ),
  http.get(apiUrl("/api/rule-editors"), () =>
    HttpResponse.json(getRuleEditorItems()),
  ),
  http.get(apiUrl("/api/rule-editors/:ruleId"), ({ params }) => {
    const item = getRuleEditorItems().find((rule) => rule.id === params.ruleId);
    return item
      ? HttpResponse.json(item)
      : HttpResponse.text("Rule not found", { status: 404 });
  }),
  http.post(apiUrl("/api/rule-editors"), async ({ request }) => {
    const editor = (await request.json()) as AccessControlRuleEditor;
    const id = `mock-rule-${nextRuleId++}`;
    const rule = ruleFromEditor(editor, id);
    currentDraft = { ...currentDraft, rules: [...currentDraft.rules, rule] };
    return HttpResponse.json({ id, rule: getRuleEditor(rule) });
  }),
  http.put(apiUrl("/api/rule-editors/:ruleId"), async ({ params, request }) => {
    const editor = (await request.json()) as AccessControlRuleEditor;
    const ruleId = String(params.ruleId);
    if (!currentDraft.rules.some((rule) => rule.id === ruleId)) {
      return HttpResponse.text("Rule not found", { status: 404 });
    }
    const rule = ruleFromEditor(editor, ruleId);
    currentDraft = {
      ...currentDraft,
      rules: currentDraft.rules.map((currentRule) =>
        currentRule.id === ruleId ? rule : currentRule,
      ),
    };
    return HttpResponse.json({ id: ruleId, rule: getRuleEditor(rule) });
  }),
  http.get(apiUrl("/api/rules/:ruleId"), ({ params }) => {
    const rule = getRules().find((item) => item.id === params.ruleId);
    return rule
      ? HttpResponse.json({ id: rule.id, rule })
      : HttpResponse.text("Rule not found", { status: 404 });
  }),
  http.post(apiUrl("/api/rules"), async ({ request }) => {
    const rule = (await request.json()) as unknown;
    if (!rule || typeof rule !== "object") {
      return HttpResponse.text("Rule payload must be an object", {
        status: 400,
      });
    }
    currentDraft = {
      ...currentDraft,
      rules: [
        ...currentDraft.rules,
        rule as AccessControlConfigDraft["rules"][number],
      ],
    };
    const id = `mock-rule-${nextRuleId++}`;
    const createdRule = { ...(rule as AccessControlConfigDraft["rules"][number]), id };
    currentDraft = {
      ...currentDraft,
      rules: [...currentDraft.rules.slice(0, -1), createdRule],
    };
    return HttpResponse.json({ id, rule: createdRule });
  }),
  http.put(apiUrl("/api/rules/:ruleId"), async ({ params, request }) => {
    const ruleId = String(params.ruleId);
    const rule = (await request.json()) as unknown;
    if (!rule || typeof rule !== "object") {
      return HttpResponse.text("Invalid rule update", { status: 400 });
    }
    if (!currentDraft.rules.some((item) => item.id === ruleId)) {
      return HttpResponse.text("Rule not found", { status: 404 });
    }
    currentDraft = {
      ...currentDraft,
      rules: currentDraft.rules.map((item) =>
        item.id === ruleId
          ? { ...(rule as AccessControlConfigDraft["rules"][number]), id: ruleId }
          : item,
      ),
    };
    return HttpResponse.json({ id: ruleId, rule: currentDraft.rules.find((item) => item.id === ruleId) });
  }),
  http.patch(apiUrl("/api/rules/:ruleId"), async ({ params, request }) => {
    const ruleId = String(params.ruleId);
    const patch = (await request.json()) as Record<string, unknown>;
    if (!patch || typeof patch !== "object") {
      return HttpResponse.text("Invalid rule patch", { status: 400 });
    }
    if (!currentDraft.rules.some((item) => item.id === ruleId)) {
      return HttpResponse.text("Rule not found", { status: 404 });
    }
    currentDraft = {
      ...currentDraft,
      rules: currentDraft.rules.map((item) =>
        item.id === ruleId
          ? ({ ...item, ...patch, id: ruleId } as AccessControlConfigDraft["rules"][number])
          : item,
      ),
    };
    return HttpResponse.json({ id: ruleId, rule: currentDraft.rules.find((item) => item.id === ruleId) });
  }),
  http.delete(apiUrl("/api/rules/:ruleId"), ({ params }) => {
    const ruleId = String(params.ruleId);
    if (!currentDraft.rules.some((rule) => rule.id === ruleId)) {
      return HttpResponse.text("Rule not found", { status: 404 });
    }
    currentDraft = {
      ...currentDraft,
      rules: currentDraft.rules.filter((rule) => rule.id !== ruleId),
    };
    return HttpResponse.text("", { status: 204 });
  }),
  http.get(apiUrl("/api/groups"), () => HttpResponse.json(getGroups())),
  http.get(apiUrl("/api/groups/:groupName"), ({ params }) => {
    const group = getGroups().find((item) => item.name === params.groupName);
    return group
      ? HttpResponse.json(group)
      : HttpResponse.text("Group not found", { status: 404 });
  }),
  http.post(apiUrl("/api/groups"), async ({ request }) => {
    const payload = (await request.json()) as {
      name?: string;
      members?: string[];
    };
    if (!payload.name || !Array.isArray(payload.members)) {
      return HttpResponse.text("Invalid group payload", { status: 400 });
    }
    currentDraft = {
      ...currentDraft,
      aliases: {
        ...currentDraft.aliases,
        groups: {
          ...currentDraft.aliases.groups,
          [payload.name]: payload.members,
        },
      },
    };
    return HttpResponse.json({ name: payload.name, members: payload.members });
  }),
  http.put(apiUrl("/api/groups/:groupName"), async ({ params, request }) => {
    const payload = (await request.json()) as {
      name?: string;
      members?: string[];
    };
    const name = String(params.groupName);
    if (!payload.members) {
      return HttpResponse.text("Invalid group payload", { status: 400 });
    }
    const nextName = payload.name ?? name;
    const groups = { ...currentDraft.aliases.groups };
    delete groups[name];
    groups[nextName] = payload.members;
    currentDraft = {
      ...currentDraft,
      aliases: { ...currentDraft.aliases, groups },
    };
    return HttpResponse.json({ name: nextName, members: payload.members });
  }),
  http.patch(apiUrl("/api/groups/:groupName"), async ({ params, request }) => {
    const payload = (await request.json()) as {
      name?: string;
      members?: string[];
    };
    const name = String(params.groupName);
    const group = currentDraft.aliases.groups[name];
    if (!group) {
      return HttpResponse.text("Group not found", { status: 404 });
    }
    const nextName = payload.name ?? name;
    const nextMembers = payload.members ?? group;
    const groups = { ...currentDraft.aliases.groups };
    delete groups[name];
    groups[nextName] = nextMembers;
    currentDraft = {
      ...currentDraft,
      aliases: { ...currentDraft.aliases, groups },
    };
    return HttpResponse.json({ name: nextName, members: nextMembers });
  }),
  http.delete(apiUrl("/api/groups/:groupName"), ({ params }) => {
    const name = String(params.groupName);
    if (!currentDraft.aliases.groups[name]) {
      return HttpResponse.text("Group not found", { status: 404 });
    }
    const groups = { ...currentDraft.aliases.groups };
    delete groups[name];
    currentDraft = {
      ...currentDraft,
      aliases: { ...currentDraft.aliases, groups },
    };
    return HttpResponse.text("", { status: 204 });
  }),
  http.get(apiUrl("/api/services"), () => HttpResponse.json(getServices())),
  http.get(apiUrl("/api/services/:serviceName"), ({ params }) => {
    const service = getServices().find(
      (item) => item.name === params.serviceName,
    );
    return service
      ? HttpResponse.json(service)
      : HttpResponse.text("Service not found", { status: 404 });
  }),
  http.post(apiUrl("/api/services"), async ({ request }) => {
    const payload = (await request.json()) as {
      name?: string;
      entries?: Array<{ protocol: "tcp" | "udp"; port: number }>;
      protocol?: "tcp" | "udp";
      port?: number;
    };
    if (!payload.name) {
      return HttpResponse.text("Invalid service payload", { status: 400 });
    }
    const service = payload.entries
      ? { name: payload.name, entries: payload.entries }
      : { name: payload.name, protocol: payload.protocol, port: payload.port };
    currentDraft = {
      ...currentDraft,
      aliases: {
        ...currentDraft.aliases,
        services: {
          ...currentDraft.aliases.services,
          [payload.name]:
            payload.entries ?? [
              {
                protocol: payload.protocol ?? "tcp",
                port: payload.port ?? 0,
              },
            ],
        },
      },
    };
    return HttpResponse.json(service);
  }),
  http.put(
    apiUrl("/api/services/:serviceName"),
    async ({ params, request }) => {
      const payload = (await request.json()) as {
        name?: string;
        entries?: Array<{ protocol: "tcp" | "udp"; port: number }>;
        protocol?: "tcp" | "udp";
        port?: number;
      };
      const name = String(params.serviceName);
      if (!payload.name) {
        return HttpResponse.text("Invalid service payload", { status: 400 });
      }
      const nextName = payload.name ?? name;
      const services = { ...currentDraft.aliases.services };
      delete services[name];
      services[nextName] = payload.entries ?? [
        {
          protocol: payload.protocol ?? "tcp",
          port: payload.port ?? 0,
        },
      ];
      currentDraft = {
        ...currentDraft,
        aliases: { ...currentDraft.aliases, services },
      };
      return HttpResponse.json(
        payload.entries
          ? { name: nextName, entries: payload.entries }
          : { name: nextName, protocol: payload.protocol, port: payload.port },
      );
    },
  ),
  http.patch(
    apiUrl("/api/services/:serviceName"),
    async ({ params, request }) => {
      const payload = (await request.json()) as {
        name?: string;
        entries?: Array<{ protocol: "tcp" | "udp"; port: number }>;
        protocol?: "tcp" | "udp";
        port?: number;
      };
      const name = String(params.serviceName);
      const service = currentDraft.aliases.services[name];
      if (!service) {
        return HttpResponse.text("Service not found", { status: 404 });
      }
      const nextName = payload.name ?? name;
      const services = { ...currentDraft.aliases.services };
      delete services[name];
      services[nextName] = payload.entries ?? service;
      currentDraft = {
        ...currentDraft,
        aliases: { ...currentDraft.aliases, services },
      };
      return HttpResponse.json(
        payload.entries
          ? { name: nextName, entries: payload.entries }
          : { name: nextName, protocol: payload.protocol, port: payload.port },
      );
    },
  ),
  http.delete(apiUrl("/api/services/:serviceName"), ({ params }) => {
    const name = String(params.serviceName);
    if (!currentDraft.aliases.services[name]) {
      return HttpResponse.text("Service not found", { status: 404 });
    }
    const services = { ...currentDraft.aliases.services };
    delete services[name];
    currentDraft = {
      ...currentDraft,
      aliases: { ...currentDraft.aliases, services },
    };
    return HttpResponse.text("", { status: 204 });
  }),
];
