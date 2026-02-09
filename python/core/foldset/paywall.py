from __future__ import annotations

from .types import PaymentMethod, Restriction


def generate_paywall_html(
    restriction: Restriction,
    payment_methods: list[PaymentMethod],
    url: str,
    terms_of_service_url: str | None = None,
) -> str:
    # Group payment methods by network
    methods_by_network: dict[str, list[PaymentMethod]] = {}
    for pm in payment_methods:
        methods_by_network.setdefault(pm.caip2_id, []).append(pm)

    payment_options_parts: list[str] = []
    for methods in methods_by_network.values():
        chain_display_name = methods[0].chain_display_name
        chain_caip2_id = methods[0].caip2_id
        recipient_address = methods[0].circle_wallet_address

        accepted_tokens_parts: list[str] = []
        for pm in methods:
            scheme = restriction.scheme.capitalize()
            accepted_tokens_parts.append(
                f"""
        <div class="token-row">
          <span class="token-name">{pm.asset_display_name}</span>
          <span class="token-details">
            <span class="token-scheme">{scheme}</span>
            <span class="token-price">${restriction.price}</span>
          </span>
        </div>"""
            )

        accepted_tokens_html = "".join(accepted_tokens_parts)
        payment_options_parts.append(
            f"""
    <div class="card">
      <div class="card-header">
        <h3>{chain_display_name}</h3>
        <span class="chain-id">{chain_caip2_id}</span>
      </div>
      <div class="pay-to"><strong>Pay to:</strong> <code>{recipient_address}</code></div>
      {accepted_tokens_html}
    </div>"""
        )

    payment_options_html = "\n".join(payment_options_parts)

    tos_row = ""
    if terms_of_service_url:
        tos_row = f'\n    <div class="resource-row"><strong>Terms of Service</strong> <a href="{terms_of_service_url}">{terms_of_service_url}</a></div>'

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HTTP 402 - Payment Required</title>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * {{ box-sizing: border-box; }}
    body {{ font-family: 'Inter', system-ui, sans-serif; max-width: 600px; margin: 32px auto; padding: 0 16px; background: #fff; color: #111; -webkit-font-smoothing: antialiased; font-size: 14px; }}
    h1 {{ font-size: 20px; margin-bottom: 4px; }}
    h2 {{ font-size: 15px; margin-top: 24px; margin-bottom: 8px; }}
    h3 {{ font-size: 14px; margin-top: 0; margin-bottom: 10px; }}
    a {{ color: #00aa5e; }}
    code {{ background: #f0f0f0; padding: 2px 5px; border-radius: 3px; font-size: 11px; font-family: 'IBM Plex Mono', monospace; word-break: break-all; }}
    .resource {{ margin: 12px 0; padding: 10px 12px; background: #f7f7f7; border: 1px solid #e5e5e5; border-radius: 5px; }}
    .resource-row {{ display: flex; gap: 6px; align-items: baseline; margin-bottom: 4px; font-size: 13px; color: #555; }}
    .resource-row:last-child {{ margin-bottom: 0; }}
    .resource-row strong {{ color: #111; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; }}
    .card {{ margin: 12px 0; padding: 12px; border: 1px solid #e5e5e5; border-radius: 5px; }}
    .card-header {{ display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }}
    .card-header h3 {{ margin: 0; }}
    .card-header .chain-id {{ color: #888; font-size: 11px; font-weight: 400; }}
    .pay-to {{ font-size: 12px; color: #555; margin-bottom: 10px; }}
    .pay-to strong {{ color: #111; }}
    .token-row {{ display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-top: 1px solid #f0f0f0; font-size: 13px; }}
    .token-name {{ font-weight: 500; color: #111; }}
    .token-details {{ display: flex; gap: 12px; align-items: center; color: #555; font-size: 12px; }}
    .token-price {{ font-weight: 500; color: #111; }}
    .token-scheme {{ font-size: 11px; color: #888; text-transform: capitalize; }}
    p {{ color: #555; font-size: 13px; line-height: 1.5; }}
    footer {{ margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #888; }}
    ::selection {{ background: #00ff88; color: #000; }}
  </style>
</head>
<body>
  <h1>402: Payment Required</h1>
  <p>This content requires payment via the <a href="https://github.com/coinbase/x402">x402 protocol</a>.</p>

  <div class="resource">
    <div class="resource-row"><strong>URL</strong> <code>{url}</code></div>
    <div class="resource-row"><strong>Description</strong> {restriction.description}</div>{tos_row}
  </div>

  <h2>Payment Options</h2>
  {payment_options_html}

  <footer>
    Powered by <a href="https://www.foldset.com">Foldset</a>
  </footer>
</body>
</html>"""
