import type { RouteConfig, RoutesConfig } from "@x402/core/http";
import type { Network } from "@x402/core/types";

import type { PaymentMethod, Rule } from "./types";

export function priceToAmount(priceUsd: number, decimals: number): string {
  const amount = priceUsd * Math.pow(10, decimals);
  return Math.round(amount).toString();
}

export function buildRouteEntry(
  rule: Rule,
  paymentMethods: PaymentMethod[],
  termsOfServiceUrl?: string,
): RouteConfig & { rule: Rule } {
  return {
    accepts: paymentMethods.map((pm) => ({
      scheme: rule.scheme,
      price: {
        amount: priceToAmount(rule.price, pm.decimals),
        asset: pm.contract_address,
        extra: {
          ...pm.extra,
          ...(termsOfServiceUrl && { termsOfServiceUrl }),
        },
      },
      network: pm.caip2_id as Network,
      payTo: pm.circle_wallet_address,
    })),
    description: rule.description,
    mimeType: "application/json",
    rule,
  };
}

export function buildRoutesConfig(
  rules: Rule[],
  paymentMethods: PaymentMethod[],
  termsOfServiceUrl?: string,
): RoutesConfig {
  const routesConfig: RoutesConfig = {};

  for (const r of rules) {
    if (r.type === "mcp") continue;
    const key = r.type === "api" && r.httpMethod ? `${r.httpMethod.toUpperCase()} ${r.path}` : r.path;
    routesConfig[key] = buildRouteEntry(r, paymentMethods, termsOfServiceUrl);
  }

  return routesConfig;
}
