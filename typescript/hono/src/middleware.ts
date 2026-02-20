import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import type { StatusCode } from "hono/utils/http-status";
import type { FoldsetOptions } from "@foldset/core";
import { WorkerCore, FOLDSET_VERIFIED_HEADER, reportError } from "@foldset/core";

import packageJson from "../package.json" with { type: "json" };
import { HonoAdapter } from "./adapter";

function setHeaders(c: Context, headers: Record<string, string>): void {
  for (const [key, value] of Object.entries(headers)) {
    c.header(key, value);
  }
}

export function foldset(options: FoldsetOptions): MiddlewareHandler {
  if (!options.apiKey) {
    console.warn("[foldset] No API key provided, middleware disabled");
    return createMiddleware(async (_c, next) => {
      await next();
    });
  }

  const opts: FoldsetOptions = { ...options, platform: "hono", sdkVersion: packageJson.version };

  return createMiddleware(async (c, next) => {
    try {
      c.req.raw.headers.delete(FOLDSET_VERIFIED_HEADER);

      const core = await WorkerCore.fromOptions(opts);
      const adapter = new HonoAdapter(c);

      const result = await core.processRequest(adapter);

      switch (result.type) {
        case "health-check":
          return c.newResponse(result.response.body, result.response.status, result.response.headers);

        case "no-payment-required":
          if (result.headers) {
            setHeaders(c, result.headers);
          }
          await next();
          return;

        case "payment-error": {
          const { body, status, headers } = result.response;
          return c.newResponse(body as string, status as StatusCode, headers);
        }

        case "payment-verified": {
          c.req.raw.headers.set(FOLDSET_VERIFIED_HEADER, "true");
          await next();

          const settlement = await core.processSettlement(
            adapter,
            result.paymentPayload,
            result.paymentRequirements,
            c.res.status,
            result.metadata.request_id,
          );

          if (settlement.success) {
            setHeaders(c, settlement.headers);
          } else {
            c.res = c.newResponse(
              JSON.stringify({ error: "Settlement failed", details: settlement.errorReason }),
              402 as StatusCode,
              { "Content-Type": "application/json" },
            );
          }
          return;
        }
      }
    } catch (error) {
      // On any error, allow the request through rather than blocking the user.
      reportError(opts.apiKey, error, new HonoAdapter(c));
      await next();
    }
  });
}
