import type { PaymentMethod, Restriction } from "./types";

export function generatePaywallHtml(
  restriction: Restriction,
  paymentMethods: PaymentMethod[],
  url: string,
  termsOfServiceUrl?: string,
): string {
  // Group payment methods by network
  const methodsByNetwork = new Map<string, PaymentMethod[]>();
  for (const pm of paymentMethods) {
    const existing = methodsByNetwork.get(pm.caip2_id) ?? [];
    existing.push(pm);
    methodsByNetwork.set(pm.caip2_id, existing);
  }

  const paymentOptionsHtml = Array.from(methodsByNetwork.values()).map((methods) => {
    const chainDisplayName = methods[0].chain_display_name;
    const chainCaip2Id = methods[0].caip2_id;
    const recipientAddress = methods[0].circle_wallet_address;

    const acceptedTokensHtml = methods.map((pm) => {
      const scheme = restriction.scheme
        .toLowerCase()
        .replace(/^./, c => c.toUpperCase());

      return `
        <div class="token-row">
          <span class="token-name">${pm.asset_display_name}</span>
          <span class="token-details">
            <span class="token-scheme">${scheme}</span>
            <span class="token-price">$${restriction.price}</span>
          </span>
        </div>`;
    }).join("");

    return `
    <div class="card">
      <div class="card-header">
        <h3>${chainDisplayName}</h3>
        <span class="chain-id">${chainCaip2Id}</span>
      </div>
      <div class="pay-to"><strong>Pay to:</strong> <code>${recipientAddress}</code></div>
      ${acceptedTokensHtml}
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HTTP 402 - Payment Required</title>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; max-width: 600px; margin: 32px auto; padding: 0 16px; background: #fff; color: #111; -webkit-font-smoothing: antialiased; font-size: 14px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    h2 { font-size: 15px; margin-top: 24px; margin-bottom: 8px; }
    h3 { font-size: 14px; margin-top: 0; margin-bottom: 10px; }
    a { color: #00aa5e; }
    code { background: #f0f0f0; padding: 2px 5px; border-radius: 3px; font-size: 11px; font-family: 'IBM Plex Mono', monospace; word-break: break-all; }
    .resource { margin: 12px 0; padding: 10px 12px; background: #f7f7f7; border: 1px solid #e5e5e5; border-radius: 5px; }
    .resource-row { display: flex; gap: 6px; align-items: baseline; margin-bottom: 4px; font-size: 13px; color: #555; }
    .resource-row:last-child { margin-bottom: 0; }
    .resource-row strong { color: #111; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; }
    .card { margin: 12px 0; padding: 12px; border: 1px solid #e5e5e5; border-radius: 5px; }
    .card-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
    .card-header h3 { margin: 0; }
    .card-header .chain-id { color: #888; font-size: 11px; font-weight: 400; }
    .pay-to { font-size: 12px; color: #555; margin-bottom: 10px; }
    .pay-to strong { color: #111; }
    .token-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-top: 1px solid #f0f0f0; font-size: 13px; }
    .token-name { font-weight: 500; color: #111; }
    .token-details { display: flex; gap: 12px; align-items: center; color: #555; font-size: 12px; }
    .token-price { font-weight: 500; color: #111; }
    .token-scheme { font-size: 11px; color: #888; text-transform: capitalize; }
    p { color: #555; font-size: 13px; line-height: 1.5; }
    footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #888; }
    ::selection { background: #00ff88; color: #000; }
  </style>
</head>
<body>
  <h1>402: Payment Required</h1>
  <p>This content requires payment via the <a href="https://github.com/coinbase/x402">x402 protocol</a>.</p>

  <div class="resource">
    <div class="resource-row"><strong>URL</strong> <code>${url}</code></div>
    <div class="resource-row"><strong>Description</strong> ${restriction.description}</div>${termsOfServiceUrl ? `\n    <div class="resource-row"><strong>Terms of Service</strong> <a href="${termsOfServiceUrl}">${termsOfServiceUrl}</a></div>` : ""}
  </div>

  <h2>Payment Options</h2>
  ${paymentOptionsHtml}

  <footer>
    Powered by <a href="https://www.foldset.com">Foldset</a>
  </footer>
</body>
</html>`;
}
