import type { FoldsetOptions } from "@foldset/core";
import { WorkerCore, FOLDSET_VERIFIED_HEADER, reportError } from "@foldset/core";
import { NextRequest, NextResponse } from "next/server";

import packageJson from "../package.json" with { type: "json" };
import { NextjsAdapter } from "./adapter";

function setHeaders(response: NextResponse, headers: Record<string, string>): void {
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
}

export function withFoldset(
  options: FoldsetOptions,
  middleware?: (request: NextRequest) => Promise<NextResponse> | NextResponse,
): (request: NextRequest) => Promise<NextResponse> {
  if (!options.apiKey) {
    console.warn("[foldset] No API key provided, payment gating disabled");
    if (middleware) return (request) => Promise.resolve(middleware(request));
    return async () => NextResponse.next();
  }

  const opts: FoldsetOptions = { ...options, platform: "nextjs", sdkVersion: packageJson.version };

  async function callMiddleware(request: NextRequest, requestHeaders: Headers): Promise<NextResponse> {
    if (middleware) return middleware(new NextRequest(request, { headers: requestHeaders }));
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return async function foldsetMiddleware(request: NextRequest): Promise<NextResponse> {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete(FOLDSET_VERIFIED_HEADER);

    try {
      const core = await WorkerCore.fromOptions(opts);
      const adapter = new NextjsAdapter(request);
      const result = await core.processRequest(adapter);

      switch (result.type) {
        case "no-payment-required": {
          const response = await callMiddleware(request, requestHeaders);
          if (result.headers) setHeaders(response, result.headers);
          return response;
        }

        case "payment-error":
          return new NextResponse(result.response.body as string, {
            status: result.response.status,
            headers: result.response.headers,
          });

        case "payment-verified": {
          // TODO rfradkin: Optimistically assumes 200, Next.js middleware
          // can't see the downstream response status code.
          const settlement = await core.processSettlement(
            adapter,
            result.paymentPayload,
            result.paymentRequirements,
            200,
            result.metadata.request_id,
          );

          if (!settlement.success) {
            return new NextResponse(
              JSON.stringify({ error: "Settlement failed", details: settlement.errorReason }),
              { status: 402, headers: { "Content-Type": "application/json" } },
            );
          }

          requestHeaders.set(FOLDSET_VERIFIED_HEADER, "true");
          const response = await callMiddleware(request, requestHeaders);
          setHeaders(response, settlement.headers);
          return response;
        }
      }
    } catch (error) {
      reportError(opts.apiKey, error, new NextjsAdapter(request));
      return callMiddleware(request, requestHeaders);
    }
  };
}
