import type { ApiRestriction, PaymentMethod, ProcessRequestResult } from "./types";

export function formatApiPaymentError(
  result: Extract<ProcessRequestResult, { type: "payment-error" }>,
  restriction: ApiRestriction,
  paymentMethods: PaymentMethod[],
  termsOfServiceUrl?: string,
): void {
  result.response.body = JSON.stringify({
    error: "payment_required",
    ...result.metadata,
    message: restriction.description,
    price: restriction.price,
    ...(termsOfServiceUrl && { terms_of_service_url: termsOfServiceUrl }),
    payment_methods: paymentMethods.map((pm) => ({
      network: pm.caip2_id,
      asset: pm.contract_address,
      decimals: pm.decimals,
      pay_to: pm.circle_wallet_address,
      chain: pm.chain_display_name,
      asset_name: pm.asset_display_name,
    })),
  });
  result.response.headers["Content-Type"] = "application/json";
}
