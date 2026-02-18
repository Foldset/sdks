import { API_BASE_URL } from "./config";
import type { WorkerCore } from "./index";
import type { ErrorReport, EventPayload, RequestAdapter } from "./types";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
} as const;

export function buildEventPayload(
  adapter: RequestAdapter,
  statusCode: number,
  requestId: string,
  paymentResponse?: string,
): EventPayload {
  const url = new URL(adapter.getUrl());

  return {
    method: adapter.getMethod(),
    status_code: statusCode,
    user_agent: adapter.getUserAgent() || null,
    referer: adapter.getHeader("referer") || null,
    href: url.href,
    hostname: url.hostname,
    pathname: url.pathname,
    search: url.search,
    ip_address: adapter.getIpAddress(),
    request_id: requestId,
    ...(paymentResponse && { payment_response: paymentResponse }),
  };
}

export async function sendEvent(
  apiKey: string,
  payload: EventPayload,
  baseUrl = API_BASE_URL,
): Promise<void> {
  await fetch(`${baseUrl}/v1/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, ...JSON_HEADERS },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export async function reportError(
  apiKey: string,
  error: unknown,
  adapter?: RequestAdapter,
  baseUrl = API_BASE_URL,
): Promise<void> {
  const payload: ErrorReport = {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };

  if (adapter) {
    payload.context = {
      method: adapter.getMethod(),
      path: adapter.getPath(),
      hostname: adapter.getHost(),
      user_agent: adapter.getUserAgent() || null,
      ip_address: adapter.getIpAddress(),
    };
  }

  // Fail silently, error reporting must never break the request.
  await fetch(`${baseUrl}/v1/errors`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, ...JSON_HEADERS },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export async function logEvent(
  core: WorkerCore,
  adapter: RequestAdapter,
  statusCode: number,
  requestId: string,
  paymentResponse?: string,
): Promise<void> {
  const payload = buildEventPayload(adapter, statusCode, requestId, paymentResponse);
  await sendEvent(core.apiKey, payload, core.baseUrl);
}
