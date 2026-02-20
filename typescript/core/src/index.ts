import type { ProcessSettleResultResponse } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

import {
  API_BASE_URL,
  SdkConfigManager,
  PaymentMethodsManager,
  RulesManager,
  buildRequestMetadata,
} from "./config";
import { handleRequest, handleSettlement } from "./handler";
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
  readonly sdkConfig: SdkConfigManager;
  readonly rules: RulesManager;
  readonly paymentMethods: PaymentMethodsManager;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly httpServer: HttpServerManager;
  readonly platform: string;
  readonly sdkVersion: string;

  constructor(store: ConfigStore, apiKey: string, baseUrl: string, platform: string, sdkVersion: string) {
    this.sdkConfig = new SdkConfigManager(store);
    this.rules = new RulesManager(store);
    this.paymentMethods = new PaymentMethodsManager(store);
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.httpServer = new HttpServerManager(store);
    this.platform = platform;
    this.sdkVersion = sdkVersion;
  }

  static async fromOptions(options: FoldsetOptions): Promise<WorkerCore> {
    if (cachedCore) {
      return cachedCore;
    }

    const baseUrl = options.baseUrl ?? API_BASE_URL;
    const credentials = options.redisCredentials ?? (await fetchRedisCredentials(options.apiKey, baseUrl));
    const store = createRedisStore(credentials);
    cachedCore = new WorkerCore(store, options.apiKey, baseUrl, options.platform ?? "unknown", options.sdkVersion ?? "unknown");

    return cachedCore;
  }

  async processRequest(adapter: RequestAdapter): Promise<ProcessRequestResult> {
    const metadata = buildRequestMetadata();

    const sdkConfig = await this.sdkConfig.get();
    const mcpEndpoint = sdkConfig?.mcpEndpoint;

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
  ApiRule,
  ConfigStore,
  ErrorReport,
  EventPayload,
  FacilitatorConfig,
  FoldsetOptions,
  SdkConfig,
  HttpServerResult,
  McpRule,
  PassthroughAuthMethod,
  PaymentMethod,
  ProcessRequestResult,
  RequestAdapter,
  RequestMetadata,
  Rule,
  RuleBase,
} from "./types";

// Store
export { createRedisStore, fetchRedisCredentials } from "./store";
export type { RedisCredentials } from "./store";

// Routes
export { buildRoutesConfig, priceToAmount } from "./routes";

// Config managers
export {
  CachedConfigManager,
  FacilitatorManager,
  SdkConfigManager,
  PaymentMethodsManager,
  RulesManager,
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
export { detectAuthMethod, handlePaymentRequest, handleRequest, handleSettlement } from "./handler";
export { formatApiPaymentError } from "./api";

// Constants
export const FOLDSET_VERIFIED_HEADER = "x-foldset-verified";
