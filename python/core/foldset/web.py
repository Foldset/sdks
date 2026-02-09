from __future__ import annotations

from .paywall import generate_paywall_html
from .types import PaymentMethod, ProcessRequestResult, RequestAdapter, WebRestriction


def format_web_payment_error(
    result: ProcessRequestResult,
    restriction: WebRestriction,
    payment_methods: list[PaymentMethod],
    adapter: RequestAdapter,
    terms_of_service_url: str | None = None,
) -> None:
    result.response.body = generate_paywall_html(
        restriction, payment_methods, adapter.get_url(), terms_of_service_url
    )
    result.response.headers["Content-Type"] = "text/html"
