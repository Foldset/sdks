import type { HTTPAdapter, HTTPProcessResult } from "@x402/core/server";

import type { RedisCredentials } from "./store";

export interface FoldsetOptions {
  apiKey: string;
  redisCredentials?: RedisCredentials;
  platform?: string;
  sdkVersion?: string;
  baseUrl?: string;
}

export interface RequestMetadata {
  version: string;
  request_id: string;
  timestamp: string;
}

export type HttpServerResult = { metadata: RequestMetadata } & (
  | (Extract<HTTPProcessResult, { type: "no-payment-required" }> & { headers?: Record<string, string> })
  | (Extract<HTTPProcessResult, { type: "payment-error" }> & { restriction: Restriction })
  | Extract<HTTPProcessResult, { type: "payment-verified" }>
);

export type ProcessRequestResult = HttpServerResult;

export interface RequestAdapter extends HTTPAdapter {
  getIpAddress(): string | null;
  getHost(): string;
  getBody(): Promise<unknown>;
}

export interface ConfigStore {
  get(key: string): Promise<string | null>;
}

export interface EventPayload {
  method: string;
  status_code: number;
  user_agent: string | null;
  referer?: string | null;
  href: string;
  hostname: string;
  pathname: string;
  search: string;
  ip_address?: string | null;
  payment_response?: string;
  request_id: string;
}

export interface ErrorReport {
  error: string;
  stack?: string;
  context?: {
    method?: string;
    path?: string;
    hostname?: string;
    user_agent?: string | null;
    ip_address?: string | null;
  };
}

export type PassthroughAuthMethod = "bearer" | "api_key";

export interface SdkConfig {
  mcpEndpoint?: string;
  termsOfServiceUrl?: string;
  passthroughAuthMethods: PassthroughAuthMethod[];
}

export interface RestrictionBase {
  description: string;
  price: number;
  scheme: string;
}

export interface ApiRestriction extends RestrictionBase {
  type: "api";
  path: string;
  httpMethod?: string;
}

export interface McpRestriction extends RestrictionBase {
  type: "mcp";
  method: string;
  name: string;
}

export type Restriction = ApiRestriction | McpRestriction;

export interface PaymentMethod {
  caip2_id: string;
  decimals: number;
  contract_address: string;
  circle_wallet_address: string;
  chain_display_name: string;
  asset_display_name: string;
  extra?: Record<string, string>;
}

export interface FacilitatorConfig {
  url: string;
  verifyHeaders?: Record<string, string>;
  settleHeaders?: Record<string, string>;
  supportedHeaders?: Record<string, string>;
}
