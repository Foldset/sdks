from __future__ import annotations

import asyncio
import json
import warnings
from importlib.metadata import version as _pkg_version
from typing import Any, Callable

from django.http import HttpRequest, HttpResponse
from foldset import WorkerCore, report_error
from foldset.types import FoldsetOptions

from .adapter import DjangoAdapter

PACKAGE_VERSION = _pkg_version("foldset-django")


def _set_headers(response: HttpResponse, headers: dict[str, str]) -> None:
    for key, value in headers.items():
        response[key] = value


def _run_async(coro: Any) -> Any:
    """Run an async coroutine from sync Django context."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return pool.submit(asyncio.run, coro).result()
    return asyncio.run(coro)


class FoldsetMiddleware:
    """Django middleware for Foldset x402 payment gating.

    Add to MIDDLEWARE in settings.py:
        MIDDLEWARE = [
            ...
            "foldset_django.FoldsetMiddleware",
            ...
        ]

    Configure in settings.py:
        FOLDSET_API_KEY = "your-api-key"
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

        from django.conf import settings
        api_key = getattr(settings, "FOLDSET_API_KEY", "")

        self._disabled = not api_key
        if self._disabled:
            warnings.warn("[foldset] No FOLDSET_API_KEY in settings, middleware disabled")
            self._options = None
        else:
            self._options = FoldsetOptions(
                api_key=api_key,
                platform="django",
                sdk_version=PACKAGE_VERSION,
            )

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if self._disabled:
            return self.get_response(request)

        try:
            core = _run_async(WorkerCore.from_options(self._options))
            adapter = DjangoAdapter(request)
            result = _run_async(core.process_request(adapter))

            if result.type == "health-check":
                resp = HttpResponse(
                    result.response.body,
                    status=result.response.status,
                )
                _set_headers(resp, result.response.headers)
                return resp

            if result.type == "no-payment-required":
                response = self.get_response(request)
                if result.headers:
                    _set_headers(response, result.headers)
                return response

            if result.type == "payment-error":
                resp = HttpResponse(
                    result.response.body,
                    status=result.response.status,
                )
                _set_headers(resp, result.response.headers)
                return resp

            if result.type == "payment-verified":
                response = self.get_response(request)

                settlement = _run_async(
                    core.process_settlement(
                        adapter,
                        result.payment_payload,
                        result.payment_requirements,
                        response.status_code,
                        result.metadata.request_id,
                    )
                )

                if settlement.success:
                    _set_headers(response, settlement.headers)
                else:
                    response = HttpResponse(
                        json.dumps({
                            "error": "Settlement failed",
                            "details": settlement.error_reason,
                        }),
                        status=402,
                        content_type="application/json",
                    )

                return response

        except Exception as error:
            _run_async(report_error(self._options.api_key, error, DjangoAdapter(request)))
            return self.get_response(request)

        return self.get_response(request)
