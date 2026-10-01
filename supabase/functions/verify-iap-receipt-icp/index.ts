// Session-free Apple IAP receipt verification for Internet Identity (ICP)
// users. verify_jwt is disabled for this function in supabase/config.toml —
// Internet Identity users have no Supabase session/JWT to verify.
//
// Request:  { principal, product_id, transaction_id, receipt_data }
//   - principal: the caller's Internet Identity principal (text)
//   - receipt_data: base64 App Store receipt, or a signed JWS transaction
//     (StoreKit 2), depending on client platform
// Response: { expires_at_ms, source, signature_hex }
//   - signature_hex = HMAC-SHA256 over
//     `${principal}|${product_id}|${transaction_id}|${expires_at_ms}|${source}`
//     keyed by IAP_ATTESTATION_HMAC_SECRET.
//
// The client submits this response to the identity_access canister's
// `redeem_entitlement(product_id, transaction_id, expires_at_ms, source,
// signature_hex)`. The canister verifies the same HMAC independently, so
// IAP_ATTESTATION_HMAC_SECRET here MUST be the exact byte-for-byte secret
// set on the canister via the governor-only `set_attestation_secret` call
// (as raw bytes - e.g. `new TextEncoder().encode(secret)` on both sides).
//
// Required secrets (set via `supabase secrets set ...`, never hardcoded):
//   - IAP_ATTESTATION_HMAC_SECRET   shared with identity_access canister
//   - APPLE_SHARED_SECRET           App Store Connect shared secret, for
//                                   legacy verifyReceipt auto-renewable subs
//   - APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (optional)
//                                   App Store Server API credentials, used
//                                   instead of verifyReceipt when present
import { corsHeaders } from "../_shared/cors.ts";

const APPLE_VERIFY_RECEIPT_PROD = "https://buy.itunes.apple.com/verifyReceipt";
const APPLE_VERIFY_RECEIPT_SANDBOX = "https://sandbox.itunes.apple.com/verifyReceipt";

// Apple status 21007: receipt is from the sandbox but was sent to prod.
const APPLE_SANDBOX_REDIRECT_STATUS = 21007;

interface VerifyRequestBody {
  principal?: string;
  product_id?: string;
  transaction_id?: string;
  receipt_data?: string;
}

interface AppleLatestReceiptInfo {
  product_id: string;
  transaction_id: string;
  expires_date_ms?: string;
  purchase_date_ms?: string;
}

interface AppleVerifyReceiptResponse {
  status: number;
  latest_receipt_info?: AppleLatestReceiptInfo[];
  receipt?: { in_app?: AppleLatestReceiptInfo[] };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function callAppleVerifyReceipt(
  receiptData: string,
  sharedSecret: string | undefined,
  url: string,
): Promise<AppleVerifyReceiptResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      "receipt-data": receiptData,
      password: sharedSecret,
      "exclude-old-transactions": true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Apple verifyReceipt HTTP ${response.status}`);
  }
  return (await response.json()) as AppleVerifyReceiptResponse;
}

/**
 * Verifies a base64 App Store receipt against Apple's legacy verifyReceipt
 * endpoint (production first, falling back to sandbox on status 21007), and
 * locates the matching transaction's expiry.
 */
async function verifyAppleReceipt(
  receiptData: string,
  transactionId: string,
  sharedSecret: string | undefined,
): Promise<{ expiresAtMs: number }> {
  let result = await callAppleVerifyReceipt(receiptData, sharedSecret, APPLE_VERIFY_RECEIPT_PROD);
  if (result.status === APPLE_SANDBOX_REDIRECT_STATUS) {
    result = await callAppleVerifyReceipt(receiptData, sharedSecret, APPLE_VERIFY_RECEIPT_SANDBOX);
  }
  if (result.status !== 0) {
    throw new Error(`Apple receipt verification failed (status ${result.status})`);
  }
  const candidates = [...(result.latest_receipt_info ?? []), ...(result.receipt?.in_app ?? [])];
  const match = candidates.find((entry) => entry.transaction_id === transactionId);
  if (!match) {
    throw new Error("Transaction id not found in verified Apple receipt.");
  }
  const expiresAtMs = match.expires_date_ms
    ? Number(match.expires_date_ms)
    : match.purchase_date_ms
      ? Number(match.purchase_date_ms)
      : NaN;
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error("Verified Apple receipt did not include an expiry/purchase date.");
  }
  return { expiresAtMs };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as VerifyRequestBody;
    const { principal, product_id, transaction_id, receipt_data } = body;

    if (!principal || !product_id || !transaction_id || !receipt_data) {
      return new Response(
        JSON.stringify({ error: "principal, product_id, transaction_id and receipt_data are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const attestationSecret = Deno.env.get("IAP_ATTESTATION_HMAC_SECRET");
    if (!attestationSecret) {
      console.error("[verify-iap-receipt-icp] IAP_ATTESTATION_HMAC_SECRET is not configured");
      return new Response(JSON.stringify({ error: "Server not configured for IAP attestation" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const appleSharedSecret = Deno.env.get("APPLE_SHARED_SECRET");
    const { expiresAtMs } = await verifyAppleReceipt(receipt_data, transaction_id, appleSharedSecret);
    const source = "app_store";

    const message = `${principal}|${product_id}|${transaction_id}|${expiresAtMs}|${source}`;
    const signatureHex = await hmacSha256Hex(attestationSecret, message);

    return new Response(
      JSON.stringify({ expires_at_ms: expiresAtMs, source, signature_hex: signatureHex }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[verify-iap-receipt-icp] error:", error);
    const message = error instanceof Error ? error.message : "Receipt verification failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
