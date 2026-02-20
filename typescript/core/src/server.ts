import type { HTTPRequestContext, HTTPResponseInstructions, PaywallConfig } from "@x402/core/http";
import {
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/core/server";
import type { PaymentRequired } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { registerExactSvmScheme } from "@x402/svm/exact/server";

import {
  CACHE_TTL_MS,
  FacilitatorManager,
  SdkConfigManager,
  PaymentMethodsManager,
  RulesManager,
} from "./config";
import { buildMcpRoutesConfig } from "./mcp";
import { buildRoutesConfig } from "./routes";
import type { ConfigStore, HttpServerResult } from "./types";

/**
 * Custom parseRoutePattern that treats the path as a raw regex.
 * Rule paths (stored as regex in the DB) are used directly
 * instead of being converted by x402's glob-like pattern parser.
 */
function foldsetParseRoutePattern(pattern: string): { verb: string; regex: RegExp } {
  const [verb, path] = pattern.includes(" ") ? pattern.split(/\s+/) : ["*", pattern];
  return { verb: verb.toUpperCase(), regex: new RegExp(path, "i") };
}

/**
 * Always return the machine-readable payment-required response,
 * bypassing x402's browser detection in createHTTPResponse.
 * Body is left empty and overwritten by downstream
 */
function foldsetCreatePaymentRequiredResponse(
  this: x402HTTPResourceServer,
  paymentRequired: PaymentRequired,
): HTTPResponseInstructions {
  // @ts-expect-error - accessing private method
  const response = this.createHTTPPaymentRequiredResponse(paymentRequired);

  return {
    status: 402,
    headers: response.headers,
    body: "",
  };
}

export interface FoldsetX402HTTPServer extends x402HTTPResourceServer {
  processHTTPRequest(context: HTTPRequestContext, paywallConfig?: PaywallConfig): Promise<HttpServerResult>;
}

/**
 * Attaches the matched rule to payment-error results from the route config.
 */
const processHTTPRequestWithRule: FoldsetX402HTTPServer["processHTTPRequest"] = async function (
  this: x402HTTPResourceServer,
  context,
  paywallConfig,
) {
  const result = await x402HTTPResourceServer.prototype.processHTTPRequest.call(this, context, paywallConfig);
  if (result.type === "payment-error") {
    // @ts-expect-error - accessing private method
    const routeConfig = this.getRouteConfig(context.path, context.method);
    return { ...result, rule: routeConfig?.rule } as HttpServerResult;
  }
  return result as HttpServerResult;
};

export class HttpServerManager {
  private cached: FoldsetX402HTTPServer | null = null;
  private cacheTimestamp = 0;
  private sdkConfig: SdkConfigManager;
  private rules: RulesManager;
  private paymentMethods: PaymentMethodsManager;
  private facilitator: FacilitatorManager;

  constructor(store: ConfigStore) {
    this.sdkConfig = new SdkConfigManager(store);
    this.rules = new RulesManager(store);
    this.paymentMethods = new PaymentMethodsManager(store);
    this.facilitator = new FacilitatorManager(store);
  }

  async get(): Promise<FoldsetX402HTTPServer | null> {
    if (this.cached && Date.now() - this.cacheTimestamp < CACHE_TTL_MS) {
      return this.cached;
    }

    const [sdkConfig, rules, paymentMethods, facilitator] = await Promise.all([
      this.sdkConfig.get(),
      this.rules.get(),
      this.paymentMethods.get(),
      this.facilitator.get(),
    ]);

    if (!sdkConfig || !facilitator) {
      return null;
    }

    const server = new x402ResourceServer(facilitator);
    registerExactEvmScheme(server);
    registerExactSvmScheme(server);

    const contentRoutes = buildRoutesConfig(rules, paymentMethods, sdkConfig.termsOfServiceUrl);
    const mcpRoutes = sdkConfig.mcpEndpoint
      ? buildMcpRoutesConfig(rules, paymentMethods, sdkConfig.mcpEndpoint, sdkConfig.termsOfServiceUrl)
      : {};
    const routesConfig = { ...contentRoutes, ...mcpRoutes };

    // @ts-expect-error - overriding private method
    x402HTTPResourceServer.prototype.parseRoutePattern = foldsetParseRoutePattern;

    const httpServer = new x402HTTPResourceServer(server, routesConfig);

    // @ts-expect-error - overriding private method
    httpServer.createHTTPResponse = foldsetCreatePaymentRequiredResponse;

    httpServer.processHTTPRequest = processHTTPRequestWithRule;

    await httpServer.initialize();

    this.cached = httpServer as FoldsetX402HTTPServer;
    this.cacheTimestamp = Date.now();

    return this.cached;
  }
}
