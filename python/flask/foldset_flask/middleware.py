from __future__ import annotations

import asyncio
import json
import warnings
from importlib.metadata import version as _pkg_version
from typing import Any

from flask import Flask, Request, Response, request
from foldset import WorkerCore, report_error
from foldset.types import FoldsetOptions

from .adapter import FlaskAdapter

PACKAGE_VERSION = _pkg_version("foldset-flask")


def _set_headers(response: Response, headers: dict[str, str]) -> None:
    for key, value in headers.items():
        response.headers[key] = value


def _run_async(coro: Any) -> Any:
    """Run an async coroutine from sync Flask context."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return pool.submit(asyncio.run, coro).result()
    return asyncio.run(coro)


def foldset(options: FoldsetOptions) -> Any:
    """Create a Flask extension that registers the Foldset payment middleware.

    Usage:
        app = Flask(__name__)
        foldset(FoldsetOptions(api_key="your-key")).init_app(app)

    Or:
        app = Flask(__name__)
        foldset(FoldsetOptions(api_key="your-key"), app)
    """
    if not options.api_key:
        warnings.warn("[foldset] No API key provided, middleware disabled")
        return _NoOpExtension()

    opts = FoldsetOptions(
        api_key=options.api_key,
        redis_credentials=options.redis_credentials,
        platform="flask",
        sdk_version=PACKAGE_VERSION,
    )
    return _FoldsetExtension(opts)


class _NoOpExtension:
    def init_app(self, app: Flask) -> None:
        pass

    def __call__(self, app: Flask) -> _NoOpExtension:
        self.init_app(app)
        return self


class _FoldsetExtension:
    def __init__(self, options: FoldsetOptions, app: Flask | None = None) -> None:
        self._options = options
        if app:
            self.init_app(app)

    def __call__(self, app: Flask) -> _FoldsetExtension:
        self.init_app(app)
        return self

    def init_app(self, app: Flask) -> None:
        app.before_request(self._before_request)
        app.after_request(self._after_request)

    def _before_request(self) -> Response | None:
        try:
            core = _run_async(WorkerCore.from_options(self._options))
            adapter = FlaskAdapter(request)
            result = _run_async(core.process_request(adapter))

            if result.type == "health-check":
                resp = Response(
                    result.response.body,
                    status=result.response.status,
                )
                _set_headers(resp, result.response.headers)
                return resp

            if result.type == "no-payment-required":
                if result.headers:
                    # Store headers to apply in after_request
                    request._foldset_extra_headers = result.headers  # type: ignore[attr-defined]
                return None

            if result.type == "payment-error":
                resp = Response(
                    result.response.body,
                    status=result.response.status,
                )
                _set_headers(resp, result.response.headers)
                return resp

            if result.type == "payment-verified":
                # Store for after_request settlement
                request._foldset_settlement = {  # type: ignore[attr-defined]
                    "core": core,
                    "adapter": adapter,
                    "payment_payload": result.payment_payload,
                    "payment_requirements": result.payment_requirements,
                    "request_id": result.metadata.request_id,
                }
                return None

        except Exception as error:
            _run_async(report_error(self._options.api_key, error, FlaskAdapter(request)))
            return None

        return None

    def _after_request(self, response: Response) -> Response:
        # Apply extra headers from no-payment-required
        extra_headers = getattr(request, "_foldset_extra_headers", None)
        if extra_headers:
            _set_headers(response, extra_headers)

        # Handle settlement
        settlement_data = getattr(request, "_foldset_settlement", None)
        if settlement_data:
            try:
                settlement = _run_async(
                    settlement_data["core"].process_settlement(
                        settlement_data["adapter"],
                        settlement_data["payment_payload"],
                        settlement_data["payment_requirements"],
                        response.status_code,
                        settlement_data["request_id"],
                    )
                )

                if settlement.success:
                    _set_headers(response, settlement.headers)
                else:
                    response = Response(
                        json.dumps({
                            "error": "Settlement failed",
                            "details": settlement.error_reason,
                        }),
                        status=402,
                        content_type="application/json",
                    )
            except Exception:
                pass

        return response
