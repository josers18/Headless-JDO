#!/usr/bin/env tsx
/**
 * Diagnose the self-hosted Data 360 MCP's Salesforce OAuth path.
 *
 * The MCP at metal-vibes-61f4a authenticates to Salesforce via the
 * OAuth 2.0 `client_credentials` grant using SF_CLIENT_ID +
 * SF_CLIENT_SECRET on its own Heroku config. When the grant fails, every
 * MCP tool call bubbles up an "OAuth error: 400 invalid_grant" response.
 *
 * This script mirrors that grant from our side so we can isolate the
 * failure: if the grant succeeds here, the MCP itself has a bug (token
 * caching, header shape, etc.). If it fails with the same error, the
 * fault is in Salesforce Connected App configuration.
 *
 * Usage:
 *   npm run diagnose:self-mcp
 *
 * Requires (passed via env):
 *   MCP_SF_CLIENT_ID        — MCP app's Salesforce Connected App client id
 *   MCP_SF_CLIENT_SECRET    — matching client secret
 *   MCP_SF_LOGIN_URL        — the org's login URL
 *                             (e.g. https://storm-16a17dc388fbe6.demo.my.salesforce.com)
 *
 * These env names intentionally differ from the Horizon app's SF_CLIENT_*
 * vars so we never confuse the two. Pull them via:
 *
 *   MCP_SF_CLIENT_ID=$(heroku config:get SF_CLIENT_ID -a metal-vibes-61f4a) \
 *   MCP_SF_CLIENT_SECRET=$(heroku config:get SF_CLIENT_SECRET -a metal-vibes-61f4a) \
 *   MCP_SF_LOGIN_URL=$(heroku config:get SF_LOGIN_URL -a metal-vibes-61f4a) \
 *     npm run diagnose:self-mcp
 *
 * Script never prints secrets to stdout. Only lengths, prefixes, and
 * Salesforce's response body (which is designed to be shared in error
 * reports).
 */

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`  FATAL: env var ${name} is not set.`);
    process.exit(2);
  }
  return v;
}

function normalizeLoginUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

async function main() {
  const clientId = required("MCP_SF_CLIENT_ID");
  const clientSecret = required("MCP_SF_CLIENT_SECRET");
  const loginUrl = normalizeLoginUrl(required("MCP_SF_LOGIN_URL"));

  console.log("Self-hosted MCP OAuth diagnostic\n");
  console.log(`  login URL  : ${loginUrl}`);
  console.log(`  client_id  : len=${clientId.length}  prefix=${clientId.slice(0, 3)}...`);
  console.log(`  client_sec : len=${clientSecret.length}  (hidden)\n`);

  const tokenUrl = `${loginUrl}/services/oauth2/token`;
  console.log(`POST ${tokenUrl}`);
  console.log("  grant_type=client_credentials\n");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (e) {
    console.error(`  NETWORK ERROR: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  const elapsed = Date.now() - start;

  const text = await res.text();
  console.log(`  status: ${res.status} (${elapsed}ms)`);
  console.log(`  body  : ${text.slice(0, 600)}\n`);

  if (res.ok) {
    // Token response has access_token + instance_url. Never print.
    let parsed: { access_token?: string; instance_url?: string; token_type?: string; issued_at?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      /* already logged */
    }
    console.log("✓ OAuth client_credentials grant SUCCEEDED.");
    console.log(`  instance_url : ${parsed.instance_url ?? "(missing)"}`);
    console.log(`  token_type   : ${parsed.token_type ?? "(missing)"}`);
    console.log(
      `  access_token : len=${parsed.access_token?.length ?? 0} (hidden)`
    );
    console.log(
      "\nImplication: the OAuth grant itself works. If the MCP still returns"
    );
    console.log(
      "`invalid_grant` via the SSE interface, the issue is either (a) token"
    );
    console.log(
      "caching inside the MCP (restart it with `heroku restart -a metal-vibes-61f4a`)"
    );
    console.log("or (b) a header/request shape difference.");
    return;
  }

  // Error path — classify the Salesforce error.
  let parsed: { error?: string; error_description?: string } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* already logged */
  }

  console.log("✗ OAuth client_credentials grant FAILED.");
  console.log(`  error         : ${parsed.error ?? "(unknown)"}`);
  console.log(`  description   : ${parsed.error_description ?? "(none)"}\n`);

  switch (parsed.error_description) {
    case "no client credentials user enabled":
      console.log(
        "Diagnosis: the Connected App's OAuth Policies do not have an"
      );
      console.log(
        "*Execute As* user set for the Client Credentials flow."
      );
      console.log("\nFix (Salesforce Setup):");
      console.log("  1. Setup → App Manager → find the Connected App matching client_id");
      console.log("  2. Click ▼ → View (not Edit)");
      console.log("  3. Click `Manage` → `Edit Policies`");
      console.log(
        "  4. Under `Client Credentials Flow`, pick a user in `Execute As`"
      );
      console.log("  5. Save");
      console.log(
        "  6. heroku restart -a metal-vibes-61f4a  (clears any cached bad token)"
      );
      break;
    case "invalid_client_id":
      console.log(
        "Diagnosis: the client_id is wrong or the Connected App was deleted/renamed."
      );
      break;
    case "invalid_client":
      console.log(
        "Diagnosis: client_secret is wrong OR the Connected App's `Enable OAuth Settings`"
      );
      console.log("is off OR client_credentials is not in `Selected OAuth Flows`.");
      break;
    default:
      console.log(
        "Diagnosis: unexpected error code — inspect the raw body above."
      );
  }
}

main().catch((e) => {
  console.error("Diagnostic crashed:", e);
  process.exit(1);
});
