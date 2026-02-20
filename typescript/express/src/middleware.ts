import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { FoldsetOptions } from "@foldset/core";
import { WorkerCore, FOLDSET_VERIFIED_HEADER, reportError } from "@foldset/core";

import packageJson from "../package.json" with { type: "json" };
import { ExpressAdapter } from "./adapter";

function setHeaders(res: Response, headers: Record<string, string>): void {
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}

export function foldset(options: FoldsetOptions): RequestHandler {
  if (!options.apiKey) {
    console.warn("[foldset] No API key provided, middleware disabled");
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const opts: FoldsetOptions = { ...options, platform: "express", sdkVersion: packageJson.version };

  return async function foldsetMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      delete req.headers[FOLDSET_VERIFIED_HEADER];

      const core = await WorkerCore.fromOptions(opts);
      const adapter = new ExpressAdapter(req);

      const result = await core.processRequest(adapter);

      switch (result.type) {
        case "no-payment-required":
          if (result.headers) {
            setHeaders(res, result.headers);
          }
          return next();

        case "payment-error":
          setHeaders(res, result.response.headers);
          return res.status(result.response.status).send(result.response.body);

        case "payment-verified": {
          req.headers[FOLDSET_VERIFIED_HEADER] = "true";
          const originalEnd = res.end.bind(res);

          res.end = function (
            chunk?: unknown,
            encoding?: BufferEncoding | (() => void),
            cb?: () => void,
          ): Response {
            core
              .processSettlement(
                adapter,
                result.paymentPayload,
                result.paymentRequirements,
                res.statusCode,
                result.metadata.request_id,
              )
              .then((settlement) => {
                if (settlement.success) {
                  setHeaders(res, settlement.headers);
                } else {
                  res.statusCode = 402;
                  res.setHeader("Content-Type", "application/json");
                  chunk = JSON.stringify({ error: "Settlement failed", details: settlement.errorReason });
                }
              })
              .finally(() => {
                if (typeof encoding === "function") {
                  originalEnd(chunk as string, encoding);
                } else if (encoding) {
                  originalEnd(chunk as string, encoding, cb);
                } else {
                  originalEnd(chunk as string, cb);
                }
              });

            return res;
          } as typeof res.end;

          return next();
        }
      }
    } catch (error) {
      // On any error, allow the request through rather than blocking the user.
      reportError(opts.apiKey, error, new ExpressAdapter(req));
      return next();
    }
  };
}
