import crypto from "node:crypto";
import { requireEnv } from "@/lib/utils";

export interface SfTokenResponse {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  id: string;
  token_type: string;
  issued_at: string;
  signature: string;
  scope?: string;
}

// Scopes required for the Salesforce MCP gateway at api.salesforce.com.
//
// Base scopes:
//   mcp_api          - "Access Salesforce hosted MCP servers" (gateway auth
//                      check; without it every MCP call returns Invalid token)
//   refresh_token +
//   offline_access   - enables `sf:login` to mint refreshable tokens
//
// Data Cloud / agent-platform scopes:
//   sfap_api         - "Access Salesforce API Platform" — some custom MCP
//                      servers (including Data Cloud / Data360MCP) require
//                      this to show up in the gateway's per-user server
//                      visibility filter. Without it, Data360MCP returns
//                      "Server definition not found" (a misleading 404 —
//                      the server exists, but is filtered out for this
//                      token).
//   cdp_api          - Data Cloud / CDP access
//   cdp_query_api    - Data Cloud SQL query access (powers postDcQuerySql)
//   cdp_profile_api  - Data Cloud unified-profile reads
// The authorize request scope string MUST be:
//   a) a SUBSET of what the ECA has Selected (asking for a scope the ECA
//      doesn't allow returns OAUTH_APPROVAL_ERROR_GENERIC), AND
//   b) short enough — Salesforce enforces a scope-count ceiling (~5) per
//      authorize request; exceeding it returns OAUTH_CODE_CRED_SCOPE_TOO_LONG.
//
// `cdp_api` ("Access all Data Cloud API resources") is a blanket that covers
// cdp_profile_api / cdp_query_api / cdp_segment_api, so we don't need to
// list those separately.
export const SF_OAUTH_SCOPES =
  "mcp_api cdp_api refresh_token";

// PKCE helpers — RFC 7636. The MCP spec + Salesforce ECA flow both require
// Authorization Code + PKCE (S256). Plain Authorization Code (no PKCE) is
// rejected by ECAs.
export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function generatePkce(): PkcePair {
  // 32 bytes → 43 char base64url, within the RFC range [43, 128].
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export interface AuthorizeUrlOpts {
  state: string;
  codeChallenge: string;
  /** Override the redirect URI (useful for CLI flows using a transient port). */
  redirectUri?: string;
  /** Override the scope string. */
  scope?: string;
}

export function buildAuthorizeUrl(opts: AuthorizeUrlOpts): string {
  const clientId = requireEnv("SF_CLIENT_ID");
  const redirectUri = opts.redirectUri ?? requireEnv("SF_REDIRECT_URI");
  const loginUrl = requireEnv("SF_LOGIN_URL");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state: opts.state,
    scope: opts.scope ?? SF_OAUTH_SCOPES,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    prompt: "consent",
  });
  return `${loginUrl.replace(/\/$/, "")}/services/oauth2/authorize?${params.toString()}`;
}

export interface ExchangeCodeOpts {
  code: string;
  codeVerifier: string;
  /** Override redirect URI to match the one used in authorize. */
  redirectUri?: string;
}

export async function exchangeCodeForToken(
  opts: ExchangeCodeOpts
): Promise<SfTokenResponse> {
  const loginUrl = requireEnv("SF_LOGIN_URL");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    client_id: requireEnv("SF_CLIENT_ID"),
    // client_secret is OPTIONAL for PKCE public clients but some ECAs require
    // it. We always send it since we have it server-side.
    client_secret: requireEnv("SF_CLIENT_SECRET"),
    redirect_uri: opts.redirectUri ?? requireEnv("SF_REDIRECT_URI"),
    code_verifier: opts.codeVerifier,
  });
  const res = await fetch(
    `${loginUrl.replace(/\/$/, "")}/services/oauth2/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce token exchange failed: ${res.status} ${text}`);
  }
  return (await res.json()) as SfTokenResponse;
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<SfTokenResponse> {
  const loginUrl = requireEnv("SF_LOGIN_URL");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: requireEnv("SF_CLIENT_ID"),
    client_secret: requireEnv("SF_CLIENT_SECRET"),
  });
  const res = await fetch(
    `${loginUrl.replace(/\/$/, "")}/services/oauth2/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce token refresh failed: ${res.status} ${text}`);
  }
  return (await res.json()) as SfTokenResponse;
}

// Client Credentials flow — only useful for ECAs that explicitly enable it
// with a Run As user. Salesforce MCP ECAs that use PKCE typically do not
// support this flow; prefer `scripts/sf-login.ts` for headless smoke tests.
export async function clientCredentialsToken(): Promise<SfTokenResponse> {
  const base = process.env.SF_INSTANCE_URL ?? requireEnv("SF_LOGIN_URL");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: requireEnv("SF_CLIENT_ID"),
    client_secret: requireEnv("SF_CLIENT_SECRET"),
  });
  const res = await fetch(
    `${base.replace(/\/$/, "")}/services/oauth2/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Salesforce client-credentials flow failed: ${res.status} ${text}`
    );
  }
  return (await res.json()) as SfTokenResponse;
}
