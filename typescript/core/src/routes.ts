import type { RouteConfig, RoutesConfig } from "@x402/core/http";
import type { Network } from "@x402/core/types";

import type { PaymentMethod, Restriction } from "./types";

export function priceToAmount(priceUsd: number, decimals: number): string {
  const amount = priceUsd * Math.pow(10, decimals);
  return Math.round(amount).toString();
}

export function buildRouteEntry(
  restriction: Restriction,
  paymentMethods: PaymentMethod[],
  termsOfServiceUrl?: string,
): RouteConfig & { restriction: Restriction } {
  return {
    accepts: paymentMethods.map((pm) => ({
      scheme: restriction.scheme,
      price: {
        amount: priceToAmount(restriction.price, pm.decimals),
        asset: pm.contract_address,
        extra: {
          ...pm.extra,
          ...(termsOfServiceUrl && { termsOfServiceUrl }),
        },
      },
      network: pm.caip2_id as Network,
      payTo: pm.circle_wallet_address,
    })),
    description: restriction.description,
    mimeType: "application/json",
    restriction,
  };
}

export function buildRoutesConfig(
  restrictions: Restriction[],
  paymentMethods: PaymentMethod[],
  termsOfServiceUrl?: string,
): RoutesConfig {
  const routesConfig: RoutesConfig = {};

  for (const r of restrictions) {
    if (r.type === "mcp") continue;
    const key = r.type === "api" && r.httpMethod ? `${r.httpMethod.toUpperCase()} ${r.path}` : r.path;
    routesConfig[key] = buildRouteEntry(r, paymentMethods, termsOfServiceUrl);
  }

  return routesConfig;
}
