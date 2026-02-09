from __future__ import annotations

import json
from typing import Any

from foldset import WorkerCore, report_error
from foldset.types import FoldsetOptions
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from .adapter import FastAPIAdapter

from importlib.metadata import version as _pkg_version

PACKAGE_VERSION = _pkg_version("foldset-fastapi")


def _set_headers(response: Response, headers: dict[str, str]) -> None:
    for key, value in headers.items():
        response.headers[key] = value


class FoldsetMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Any, options: FoldsetOptions) -> None:
        super().__init__(app)
        self._options = FoldsetOptions(
            api_key=options.api_key,
            redis_credentials=options.redis_credentials,
            platform="fastapi",
            sdk_version=PACKAGE_VERSION,
        )
        self._disabled = not options.api_key
        if self._disabled:
            import warnings
            warnings.warn("[foldset] No API key provided, middleware disabled")

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if self._disabled:
            return await call_next(request)

        try:
            core = await WorkerCore.from_options(self._options)
            adapter = FastAPIAdapter(request)
            result = await core.process_request(adapter)

            if result.type == "health-check":
                response = Response(
                    content=result.response.body,
                    status_code=result.response.status,
                    media_type="application/json",
                )
                _set_headers(response, result.response.headers)
                return response

            if result.type == "no-payment-required":
                response = await call_next(request)
                if result.headers:
                    _set_headers(response, result.headers)
                return response

            if result.type == "payment-error":
                response = Response(
                    content=result.response.body,
                    status_code=result.response.status,
                )
                _set_headers(response, result.response.headers)
                return response

            if result.type == "payment-verified":
                response = await call_next(request)

                settlement = await core.process_settlement(
                    adapter,
                    result.payment_payload,
                    result.payment_requirements,
                    response.status_code,
                    result.metadata.request_id,
                )

                if settlement.success:
                    _set_headers(response, settlement.headers)
                else:
                    response = Response(
                        content=json.dumps({
                            "error": "Settlement failed",
                            "details": settlement.error_reason,
                        }),
                        status_code=402,
                        media_type="application/json",
                    )

                return response

        except Exception as error:
            # On any error, allow the request through rather than blocking the user.
            await report_error(self._options.api_key, error, FastAPIAdapter(request))
            return await call_next(request)

        return await call_next(request)
