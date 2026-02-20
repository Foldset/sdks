import type { HTTPRequestContext, ProcessSettleResultResponse } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

import { formatApiPaymentError } from "./api";
import { noPaymentRequired } from "./config";
import type { WorkerCore } from "./index";
import { logEvent } from "./telemetry";
import type { PassthroughAuthMethod, ProcessRequestResult, RequestAdapter, RequestMetadata } from "./types";

function settlementFailure(
  reason: string,
  network: PaymentRequirements["network"],
): ProcessSettleResultResponse {
  return { success: false, errorReason: reason, network, transaction: "" };
}

export async function handlePaymentRequest(
  core: WorkerCore,
  adapter: RequestAdapter,
  metadata: RequestMetadata,
  pathOverride?: string,
): Promise<ProcessRequestResult> {
  const httpServer = await core.httpServer.get();
  if (!httpServer) {
    return noPaymentRequired(metadata);
  }

  const path = pathOverride ?? adapter.getPath();

  const paymentContext: HTTPRequestContext = {
    adapter,
    path,
    method: adapter.getMethod(),
    paymentHeader:
      adapter.getHeader("PAYMENT-SIGNATURE") ||
      adapter.getHeader("X-PAYMENT"),
  };

  if (!httpServer.requiresPayment(paymentContext)) {
    return noPaymentRequired(metadata);
  }

  const result = await httpServer.processHTTPRequest(paymentContext, undefined);
  result.metadata = metadata;

  if (result.type === "payment-error") {
    if (result.restriction.price === 0) {
      await logEvent(core, adapter, 200, metadata.request_id);
      return noPaymentRequired(metadata);
    }
    await logEvent(core, adapter, result.response.status, metadata.request_id);
  }

  return result;
}

export function detectAuthMethod(
  adapter: RequestAdapter,
  enabledMethods: PassthroughAuthMethod[],
): PassthroughAuthMethod | null {
  if (enabledMethods.includes("bearer")) {
    const authHeader = adapter.getHeader("authorization");
    if (authHeader?.toLowerCase().startsWith("bearer ")) {
      return "bearer";
    }
  }
  if (enabledMethods.includes("api_key")) {
    if (adapter.getHeader("x-api-key")) {
      return "api_key";
    }
  }
  return null;
}

export async function handleRequest(
  core: WorkerCore,
  adapter: RequestAdapter,
  metadata: RequestMetadata,
): Promise<ProcessRequestResult> {
  const sdkConfig = await core.sdkConfig.get();
  const passthroughMethods = sdkConfig?.passthroughAuthMethods ?? [];

  if (detectAuthMethod(adapter, passthroughMethods)) {
    return noPaymentRequired(metadata);
  }

  const result = await handlePaymentRequest(core, adapter, metadata);

  if (result.type !== "payment-error") {
    return result;
  }

  const paymentMethods = await core.paymentMethods.get();

  if (paymentMethods.length > 0 && result.restriction.type === "api") {
    formatApiPaymentError(result, result.restriction, paymentMethods, sdkConfig?.termsOfServiceUrl, passthroughMethods);
  }

  return result;
}

export async function handleSettlement(
  core: WorkerCore,
  adapter: RequestAdapter,
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
  upstreamStatusCode: number,
  requestId: string,
): Promise<ProcessSettleResultResponse> {
  const httpServer = await core.httpServer.get();
  if (!httpServer) {
    return settlementFailure("Server not initialized", paymentRequirements.network);
  }

  if (upstreamStatusCode >= 400) {
    await logEvent(core, adapter, upstreamStatusCode, requestId);
    return settlementFailure("Upstream error", paymentRequirements.network);
  }

  const result = await httpServer.processSettlement(
    paymentPayload,
    paymentRequirements,
  );

  if (result.success) {
    const paymentResponse = result.headers["PAYMENT-RESPONSE"];
    await logEvent(core, adapter, upstreamStatusCode, requestId, paymentResponse);
  } else {
    await logEvent(core, adapter, 402, requestId);
  }

  return result;
}
