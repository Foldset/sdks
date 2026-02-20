import type { RoutesConfig } from "@x402/core/http";

import { buildPaymentErrorResponse } from "./api";
import { noPaymentRequired } from "./config";
import { detectAuthMethod, handlePaymentRequest } from "./handler";
import type { WorkerCore } from "./index";
import { buildRouteEntry, priceToAmount } from "./routes";
import { logEvent } from "./telemetry";
import type {
  McpRestriction,
  PaymentMethod,
  ProcessRequestResult,
  RequestAdapter,
  RequestMetadata,
  Restriction,
} from "./types";

export interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const MCP_LIST_CALL_METHODS: Record<string, string> = {
  "tools/list": "tools/call",
  "resources/list": "resources/read",
  "prompts/list": "prompts/get",
};

export function parseMcpRequest(body: unknown): JsonRpcRequest | null {
  if (
    typeof body !== "object" ||
    body === null ||
    !("jsonrpc" in body) ||
    !("method" in body)
  ) {
    return null;
  }
  return body as JsonRpcRequest;
}

/**
 * Build the route key for an MCP restriction: "endpointPath/method:name".
 */
export function buildMcpRouteKey(
  endpointPath: string,
  restriction: McpRestriction,
): string {
  return `${endpointPath}/${restriction.method}:${restriction.name}`;
}

export function buildMcpRoutesConfig(
  restrictions: Restriction[],
  paymentMethods: PaymentMethod[],
  mcpEndpoint: string,
  termsOfServiceUrl?: string,
): RoutesConfig {
  const routesConfig: RoutesConfig = {};

  for (const r of restrictions) {
    if (r.type !== "mcp") continue;
    const key = buildMcpRouteKey(mcpEndpoint, r);
    routesConfig[key] = buildRouteEntry(r, paymentMethods, termsOfServiceUrl);
  }

  return routesConfig;
}

export function getMcpRouteKey(
  endpointPath: string,
  method: string,
  params?: Record<string, unknown>,
): string | null {
  const identifier = params?.name ?? params?.uri;
  if (typeof identifier !== "string") return null;
  return `${endpointPath}/${method}:${identifier}`;
}

export function isMcpListMethod(method: string): boolean {
  return method in MCP_LIST_CALL_METHODS;
}

export interface McpPaymentRequirement {
  name: string;
  method: string;
  description: string;
  price: number;
  scheme: string;
  accepts: Array<{
    network: string;
    chainDisplayName: string;
    asset: string;
    assetDisplayName: string;
    amount: string;
    payTo: string;
  }>;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export function buildJsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  const error: JsonRpcError = { jsonrpc: "2.0", id, error: { code, message } };
  if (data !== undefined) error.error.data = data;
  return error;
}

/**
 * Build payment requirements for all gated MCP tools/resources/prompts
 * matching the given list method. Returns clear payment instructions
 * built directly from Foldset restrictions and payment methods.
 */
export function getMcpListPaymentRequirements(
  listMethod: string,
  restrictions: Restriction[],
  paymentMethods: PaymentMethod[],
): McpPaymentRequirement[] {
  const callMethod = MCP_LIST_CALL_METHODS[listMethod];
  if (!callMethod) return [];

  const relevant = restrictions.filter(
    (r): r is McpRestriction => r.type === "mcp" && r.method === callMethod && r.price > 0,
  );
  if (!relevant.length) return [];

  return relevant.map((r) => ({
    name: r.name,
    method: r.method,
    description: r.description,
    price: r.price,
    scheme: r.scheme,
    accepts: paymentMethods.map((pm) => ({
      network: pm.caip2_id,
      chainDisplayName: pm.chain_display_name,
      asset: pm.contract_address,
      assetDisplayName: pm.asset_display_name,
      amount: priceToAmount(r.price, pm.decimals),
      payTo: pm.circle_wallet_address,
    })),
  }));
}

async function formatMcpPaymentError(
  core: WorkerCore,
  result: Extract<ProcessRequestResult, { type: "payment-error" }>,
  rpcId: string | number | null,
): Promise<void> {
  const [paymentMethods, hostConfig] = await Promise.all([
    core.paymentMethods.get(),
    core.hostConfig.get(),
  ]);

  const { payload, applyHeaders } = buildPaymentErrorResponse(
    result.metadata,
    result.restriction,
    paymentMethods,
    hostConfig?.termsOfServiceUrl,
    hostConfig?.passthroughAuthMethods ?? [],
  );

  result.response.body = JSON.stringify(
    buildJsonRpcError(rpcId, 402, "Payment required", payload),
  );
  applyHeaders(result.response.headers);
}

export async function handleMcpRequest(
  core: WorkerCore,
  adapter: RequestAdapter,
  mcpEndpoint: string,
  metadata: RequestMetadata,
): Promise<ProcessRequestResult> {
  if (adapter.getMethod() !== "POST") {
    return noPaymentRequired(metadata);
  }

  const body = await adapter.getBody();
  const rpc = parseMcpRequest(body);
  if (!rpc) {
    return noPaymentRequired(metadata);
  }

  // List methods, pass through with payment requirements header
  if (isMcpListMethod(rpc.method)) {
    const [restrictions, paymentMethods, hostConfig] = await Promise.all([
      core.restrictions.get(),
      core.paymentMethods.get(),
      core.hostConfig.get(),
    ]);
    // TODO rfradkin: We shouldn't really be regenerating this list each time,
    // it should be every time requirements change
    const requirements = getMcpListPaymentRequirements(
      rpc.method,
      restrictions,
      paymentMethods,
    );
    const headers: Record<string, string> = {};
    if (requirements.length > 0) {
      const payload: Record<string, unknown> = { requirements };
      if (hostConfig?.termsOfServiceUrl) {
        payload.terms_of_service_url = hostConfig.termsOfServiceUrl;
      }
      headers["Payment-Required"] = JSON.stringify(payload);
    }
    await logEvent(core, adapter, 200, metadata.request_id);
    return { type: "no-payment-required", headers, metadata };
  }

  const hostConfig = await core.hostConfig.get();
  if (detectAuthMethod(adapter, hostConfig?.passthroughAuthMethods ?? [])) {
    return noPaymentRequired(metadata);
  }

  const routeKey = getMcpRouteKey(mcpEndpoint, rpc.method, rpc.params);
  if (!routeKey) {
    return noPaymentRequired(metadata);
  }

  const result = await handlePaymentRequest(core, adapter, metadata, routeKey);

  if (result.type === "payment-error") {
    await formatMcpPaymentError(core, result, rpc.id ?? null);
  }

  return result;
}
