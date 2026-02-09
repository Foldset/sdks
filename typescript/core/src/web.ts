import { generatePaywallHtml } from "./paywall";
import type { PaymentMethod, ProcessRequestResult, RequestAdapter, WebRestriction } from "./types";

export function formatWebPaymentError(
  result: Extract<ProcessRequestResult, { type: "payment-error" }>,
  restriction: WebRestriction,
  paymentMethods: PaymentMethod[],
  adapter: RequestAdapter,
  termsOfServiceUrl?: string,
): void {
  result.response.body = generatePaywallHtml(restriction, paymentMethods, adapter.getUrl(), termsOfServiceUrl);
  result.response.headers["Content-Type"] = "text/html";
}
