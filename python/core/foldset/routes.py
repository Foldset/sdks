from __future__ import annotations

from x402.http import PaymentOption, RouteConfig

from .types import ApiRestriction, McpRestriction, PaymentMethod, Restriction

RoutesConfig = dict[str, RouteConfig]


def price_to_amount(price_usd: float, decimals: int) -> str:
    amount = price_usd * (10**decimals)
    return str(round(amount))


def build_route_entry(
    restriction: Restriction,
    payment_methods: list[PaymentMethod],
    terms_of_service_url: str | None = None,
) -> RouteConfig:
    options = [
        PaymentOption(
            scheme=restriction.scheme,
            price=price_to_amount(restriction.price, pm.decimals),
            network=pm.caip2_id,
            pay_to=pm.circle_wallet_address,
            extra={
                **(pm.extra or {}),
                **({"termsOfServiceUrl": terms_of_service_url} if terms_of_service_url else {}),
            },
        )
        for pm in payment_methods
    ]

    config = RouteConfig(
        accepts=options,
        description=restriction.description,
        mime_type="application/json",
    )
    # Attach restriction for later lookup
    config.restriction = restriction  # type: ignore[attr-defined]
    return config


def build_routes_config(
    restrictions: list[Restriction],
    payment_methods: list[PaymentMethod],
    terms_of_service_url: str | None = None,
) -> RoutesConfig:
    routes_config: RoutesConfig = {}

    for r in restrictions:
        if isinstance(r, McpRestriction):
            continue
        key = (
            f"{r.http_method.upper()} {r.path}"
            if isinstance(r, ApiRestriction) and r.http_method
            else r.path
        )
        routes_config[key] = build_route_entry(r, payment_methods, terms_of_service_url)

    return routes_config
