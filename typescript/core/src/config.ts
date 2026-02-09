import { HTTPFacilitatorClient } from "@x402/core/server";

import packageJson from "../package.json" with { type: "json" };

const PACKAGE_VERSION = packageJson.version;
import type {
  Bot,
  ConfigStore,
  FacilitatorConfig,
  HostConfig,
  PaymentMethod,
  ProcessRequestResult,
  RequestMetadata,
  Restriction,
} from "./types";

export const CACHE_TTL_MS = 30_000;

export const API_BASE_URL = "https://api.foldset.com";

export function buildRequestMetadata(): RequestMetadata {
  return {
    version: PACKAGE_VERSION,
    request_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

export function noPaymentRequired(metadata: RequestMetadata): ProcessRequestResult {
  return { type: "no-payment-required", metadata };
}

export class CachedConfigManager<T> {
  protected cached: T;
  protected cacheTimestamp = 0;

  constructor(
    protected configStore: ConfigStore,
    protected key: string,
    protected fallback: T,
  ) {
    this.cached = fallback;
  }

  protected isCacheValid(): boolean {
    return this.cacheTimestamp > 0 && Date.now() - this.cacheTimestamp < CACHE_TTL_MS;
  }

  protected deserialize(raw: string): T {
    return JSON.parse(raw) as T;
  }

  async get(): Promise<T> {
    if (this.isCacheValid()) return this.cached;
    const raw = await this.configStore.get(this.key);
    this.cached = raw ? this.deserialize(raw) : this.fallback;
    this.cacheTimestamp = Date.now();
    return this.cached;
  }
}

export class HostConfigManager extends CachedConfigManager<HostConfig | null> {
  constructor(store: ConfigStore) {
    super(store, "host-config", null);
  }
}

export class RestrictionsManager extends CachedConfigManager<Restriction[]> {
  constructor(store: ConfigStore) {
    super(store, "restrictions", []);
  }
}

export class PaymentMethodsManager extends CachedConfigManager<PaymentMethod[]> {
  constructor(store: ConfigStore) {
    super(store, "payment-methods", []);
  }
}

export class BotsManager extends CachedConfigManager<Bot[]> {
  constructor(store: ConfigStore) {
    super(store, "bots", []);
  }

  protected override deserialize(raw: string): Bot[] {
    const parsed: Bot[] = JSON.parse(raw);
    return parsed.map((b) => ({ ...b, user_agent: b.user_agent.toLowerCase() }));
  }

  async matchBot(userAgent: string): Promise<Bot | null> {
    const bots = await this.get();
    const ua = userAgent.toLowerCase();
    return bots.find((bot) => ua.includes(bot.user_agent)) ?? null;
  }
}

export class FacilitatorManager extends CachedConfigManager<HTTPFacilitatorClient | null> {
  constructor(store: ConfigStore) {
    super(store, "facilitator", null);
  }

  protected override deserialize(raw: string): HTTPFacilitatorClient {
    const config: FacilitatorConfig = JSON.parse(raw);

    const hasAuthHeaders =
      config.verifyHeaders || config.settleHeaders || config.supportedHeaders;

    return new HTTPFacilitatorClient({
      url: config.url,
      ...(hasAuthHeaders && {
        createAuthHeaders: async () => ({
          verify: config.verifyHeaders ?? {},
          settle: config.settleHeaders ?? {},
          supported: config.supportedHeaders ?? {},
        }),
      }),
    });
  }
}
