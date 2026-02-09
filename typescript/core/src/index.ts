import type { ProcessSettleResultResponse } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

import {
  BotsManager,
  HostConfigManager,
  PaymentMethodsManager,
  RestrictionsManager,
  buildRequestMetadata,
} from "./config";
import { handleRequest, handleSettlement } from "./handler";
import { HEALTH_PATH, buildHealthResponse } from "./health";
import { handleMcpRequest } from "./mcp";
import { HttpServerManager } from "./server";
import { createRedisStore, fetchRedisCredentials } from "./store";
import type {
  ConfigStore,
  FoldsetOptions,
  ProcessRequestResult,
  RequestAdapter,
} from "./types";

let cachedCore: WorkerCore | null = null;

export class WorkerCore {
  readonly hostConfig: HostConfigManager;
  readonly restrictions: RestrictionsManager;
  readonly paymentMethods: PaymentMethodsManager;
  readonly bots: BotsManager;
  readonly apiKey: string;
  readonly httpServer: HttpServerManager;
  readonly platform: string;
  readonly sdkVersion: string;

  constructor(store: ConfigStore, apiKey: string, platform: string, sdkVersion: string) {
    this.hostConfig = new HostConfigManager(store);
    this.restrictions = new RestrictionsManager(store);
    this.paymentMethods = new PaymentMethodsManager(store);
    this.bots = new BotsManager(store);
    this.apiKey = apiKey;
    this.httpServer = new HttpServerManager(store);
    this.platform = platform;
    this.sdkVersion = sdkVersion;
  }

  static async fromOptions(options: FoldsetOptions): Promise<WorkerCore> {
    if (cachedCore) {
      return cachedCore;
    }

    const credentials = options.redisCredentials ?? (await fetchRedisCredentials(options.apiKey));
    const store = createRedisStore(credentials);
    cachedCore = new WorkerCore(store, options.apiKey, options.platform ?? "unknown", options.sdkVersion ?? "unknown");

    return cachedCore;
  }

  async processRequest(adapter: RequestAdapter): Promise<ProcessRequestResult> {
    const metadata = buildRequestMetadata();

    if (adapter.getPath() === HEALTH_PATH) {
      return {
        type: "health-check",
        metadata,
        response: {
          status: 200,
          body: buildHealthResponse(this.platform, this.sdkVersion),
          headers: { "Content-Type": "application/json" },
        },
      };
    }

    const hostConfig = await this.hostConfig.get();
    const mcpEndpoint = hostConfig?.mcpEndpoint;

    if (mcpEndpoint && adapter.getPath() === mcpEndpoint) {
      return handleMcpRequest(this, adapter, mcpEndpoint, metadata);
    }

    return handleRequest(this, adapter, metadata);
  }

  async processSettlement(
    adapter: RequestAdapter,
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
    upstreamStatusCode: number,
    requestId: string,
  ): Promise<ProcessSettleResultResponse> {
    return handleSettlement(
      this,
      adapter,
      paymentPayload,
      paymentRequirements,
      upstreamStatusCode,
      requestId,
    );
  }
}

// Types
export type {
  ApiRestriction,
  Bot,
  ConfigStore,
  ErrorReport,
  EventPayload,
  FacilitatorConfig,
  FoldsetOptions,
  HostConfig,
  HttpServerResult,
  McpRestriction,
  PaymentMethod,
  ProcessRequestResult,
  RequestAdapter,
  RequestMetadata,
  Restriction,
  RestrictionBase,
  WebRestriction,
} from "./types";

// Store
export { createRedisStore, fetchRedisCredentials } from "./store";
export type { RedisCredentials } from "./store";

// Paywall
export { generatePaywallHtml } from "./paywall";

// Routes
export { buildRoutesConfig, priceToAmount } from "./routes";

// Config managers
export {
  BotsManager,
  CachedConfigManager,
  FacilitatorManager,
  HostConfigManager,
  PaymentMethodsManager,
  RestrictionsManager,
} from "./config";

// Server
export { HttpServerManager } from "./server";

// MCP
export {
  buildJsonRpcError,
  buildMcpRouteKey,
  buildMcpRoutesConfig,
  getMcpListPaymentRequirements,
  getMcpRouteKey,
  handleMcpRequest,
  isMcpListMethod,
  parseMcpRequest,
} from "./mcp";
export type { JsonRpcError, JsonRpcRequest, McpPaymentRequirement } from "./mcp";

// Telemetry
export { buildEventPayload, logEvent, reportError, sendEvent } from "./telemetry";

// Handlers
export { handlePaymentRequest, handleRequest, handleSettlement } from "./handler";
export { formatApiPaymentError } from "./api";
export { formatWebPaymentError } from "./web";

// Health
export { HEALTH_PATH, buildHealthResponse } from "./health";
