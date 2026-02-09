import type { HTTPRequestContext, ProcessSettleResultResponse } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

import { formatApiPaymentError } from "./api";
import { noPaymentRequired } from "./config";
import type { WorkerCore } from "./index";
import { logEvent } from "./telemetry";
import type { ProcessRequestResult, RequestAdapter, RequestMetadata } from "./types";
import { formatWebPaymentError } from "./web";

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

export async function handleRequest(
  core: WorkerCore,
  adapter: RequestAdapter,
  metadata: RequestMetadata,
): Promise<ProcessRequestResult> {
  const userAgent = adapter.getUserAgent();
  const bot = userAgent ? await core.bots.matchBot(userAgent) : null;
  const hostConfig = await core.hostConfig.get();

  const shouldCheck = bot || hostConfig?.apiProtectionMode === "all";
  if (!shouldCheck) {
    return noPaymentRequired(metadata);
  }

  const result = await handlePaymentRequest(core, adapter, metadata);

  if (result.type !== "payment-error") {
    return result;
  }

  // TODO: Figure out a way to classify whether web or api sooner in the flow
  // so we don't run handlePaymentRequest for web restrictions on non-bot requests
  // Web restrictions are always bot-only
  if (result.restriction.type === "web" && !bot) {
    return noPaymentRequired(metadata);
  }

  const paymentMethods = await core.paymentMethods.get();

  if (paymentMethods.length > 0) {
    if (result.restriction.type === "api") {
      formatApiPaymentError(result, result.restriction, paymentMethods, hostConfig?.termsOfServiceUrl);
    } else if (result.restriction.type === "web") {
      formatWebPaymentError(result, result.restriction, paymentMethods, adapter, hostConfig?.termsOfServiceUrl);
    }
  }

  if (bot?.force_200) {
    result.response.status = 200;
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
