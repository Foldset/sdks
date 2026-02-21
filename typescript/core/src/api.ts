import { FOLDSET_HOW_TO_PAY_URL, FOLDSET_PROVIDER_NAME, FOLDSET_URL } from "./config";
import type { PassthroughAuthMethod, PaymentMethod, ProcessRequestResult, RequestMetadata, Rule } from "./types";

export function buildPaymentErrorResponse(
  metadata: RequestMetadata,
  rule: Rule,
  paymentMethods: PaymentMethod[],
  termsOfServiceUrl?: string,
  passthroughAuthMethods?: PassthroughAuthMethod[],
): { payload: Record<string, unknown>; applyHeaders: (headers: Record<string, string>) => void } {
  const payload: Record<string, unknown> = {
    error: "payment_required",
    ...metadata,
    description: rule.description,
    price: rule.price,
    ...(termsOfServiceUrl && { terms_of_service_url: termsOfServiceUrl }),
    payment_methods: paymentMethods.map((pm) => ({
      network: pm.caip2_id,
      asset: pm.contract_address,
      decimals: pm.decimals,
      pay_to: pm.circle_wallet_address,
      chain: pm.chain_display_name,
      asset_name: pm.asset_display_name,
    })),
    ...(passthroughAuthMethods?.length && {
      accepted_auth_methods: passthroughAuthMethods,
    }),
    explanation: "This resource is protected by Foldset using the x402 protocol. To access it, construct a payment using the details in payment_methods, encode it as a PAYMENT-SIGNATURE header, and resend your request. See how_to_pay for full instructions.",
    how_to_pay: FOLDSET_HOW_TO_PAY_URL,
    powered_by: FOLDSET_PROVIDER_NAME,
    powered_by_url: FOLDSET_URL,
  };

  function applyHeaders(headers: Record<string, string>): void {
    headers["Content-Type"] = "application/json";
    if (passthroughAuthMethods?.length) {
      const schemes: string[] = [];
      if (passthroughAuthMethods.includes("bearer")) schemes.push("Bearer");
      if (passthroughAuthMethods.includes("api_key")) schemes.push("X-API-Key");
      headers["WWW-Authenticate"] = schemes.join(", ");
    }
  }

  return { payload, applyHeaders };
}

export function formatApiPaymentError(
  result: Extract<ProcessRequestResult, { type: "payment-error" }>,
  rule: Extract<Rule, { type: "api" }>,
  paymentMethods: PaymentMethod[],
  termsOfServiceUrl?: string,
  passthroughAuthMethods?: PassthroughAuthMethod[],
): void {
  const { payload, applyHeaders } = buildPaymentErrorResponse(
    result.metadata,
    rule,
    paymentMethods,
    termsOfServiceUrl,
    passthroughAuthMethods,
  );
  result.response.body = JSON.stringify(payload);
  applyHeaders(result.response.headers);
}
