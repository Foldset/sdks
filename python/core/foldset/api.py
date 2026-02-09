from __future__ import annotations

import json

from .types import ApiRestriction, PaymentMethod, ProcessRequestResult


def format_api_payment_error(
    result: ProcessRequestResult,
    restriction: ApiRestriction,
    payment_methods: list[PaymentMethod],
    terms_of_service_url: str | None = None,
) -> None:
    body: dict = {
        "error": "payment_required",
        "version": result.metadata.version,
        "request_id": result.metadata.request_id,
        "timestamp": result.metadata.timestamp,
        "message": restriction.description,
        "price": restriction.price,
    }
    if terms_of_service_url:
        body["terms_of_service_url"] = terms_of_service_url
    body["payment_methods"] = [
        {
            "network": pm.caip2_id,
            "asset": pm.contract_address,
            "decimals": pm.decimals,
            "pay_to": pm.circle_wallet_address,
            "chain": pm.chain_display_name,
            "asset_name": pm.asset_display_name,
        }
        for pm in payment_methods
    ]
    result.response.body = json.dumps(body)
    result.response.headers["Content-Type"] = "application/json"
