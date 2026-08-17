import { http, HttpResponse } from "msw";

import {
  ACCESS_CONTROL_API_URL,
  type AccessControlConfigDraft,
} from "../api/client";
import {
  buildMockAccessControlConfigDocument,
  buildMockAccessControlState,
  mockAccessControlConfigDraft,
} from "../api/mock-data";

const apiUrl = (path: string) => new URL(path, ACCESS_CONTROL_API_URL).toString();

let currentDraft: AccessControlConfigDraft = structuredClone(mockAccessControlConfigDraft);

function buildMutationResult(draft: AccessControlConfigDraft, persisted: boolean, applied: boolean) {
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
  http.get(apiUrl("/api/state"), () => HttpResponse.json(buildMockAccessControlState(currentDraft))),
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
      backend: buildMockAccessControlState(currentDraft).backend,
      policyPath: buildMockAccessControlState(currentDraft).policyPath,
      aliasesPath: buildMockAccessControlState(currentDraft).aliasesPath,
      peers: buildMockAccessControlState(currentDraft).peers,
      aliases: buildMockAccessControlState(currentDraft).aliases,
    }),
  ),
  http.get(apiUrl("/api/aliases"), () =>
    HttpResponse.json({
      aliases: buildMockAccessControlState(currentDraft).aliases,
    }),
  ),
  http.get(apiUrl("/api/policies"), () =>
    HttpResponse.json({
      rules: buildMockAccessControlState(currentDraft).rules,
    }),
  ),
];
