/**
 * sf-login.ts — Headless OAuth 2.1 + PKCE login against a Salesforce
 * External Client App, for capturing an access token with the `mcp_api`
 * scope.
 *
 * Flow:
 *   1. Generate code_verifier + S256 code_challenge.
 *   2. Start a tiny HTTP server on http://localhost:3000 (the ECA's
 *      whitelisted callback host) that listens for /callback.
 *   3. Open the Salesforce authorize URL in the default browser.
 *   4. User logs in + consents.
 *   5. Server receives ?code=...&state=..., verifies state, exchanges
 *      code+verifier for an access token at login.salesforce.com.
 *   6. Print the token + instance URL, and write them back to .env as
 *      SF_ACCESS_TOKEN / SF_INSTANCE_URL so verify:mcp can pick them up.
 *
 * This intentionally does NOT depend on the Next.js dev server. It's the
 * CLI equivalent of visiting /api/connect in a browser.
 */

export {};

import http from "node:http";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  generatePkce,
  SF_OAUTH_SCOPES,
} from "../lib/salesforce/oauth";

const CALLBACK_HOST = "localhost";
const CALLBACK_PORT = 3000;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;

// Safe wrapper around child_process.spawn — no shell, URL passed as an arg.
// This means any chars in `url` are treated as data, not shell metacharacters.
function openBrowser(url: string) {
  let cmd: string;
  let args: string[];
  if (process.platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (process.platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {
    console.error(
      `\n⚠️  Could not auto-open browser. Please open this URL manually:\n  ${url}\n`
    );
  });
  child.unref();
}

interface CallbackResult {
  code: string;
  state: string;
}

function waitForCallback(
  expectedState: string
): Promise<{ result: CallbackResult; closeServer: () => void }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400).end("bad request");
        return;
      }
      const url = new URL(req.url, `http://${CALLBACK_HOST}:${CALLBACK_PORT}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end("not found");
        return;
      }
      const err = url.searchParams.get("error");
      if (err) {
        const desc = url.searchParams.get("error_description") ?? "";
        res
          .writeHead(400, { "Content-Type": "text/html" })
          .end(renderErrorPage(err, desc));
        reject(new Error(`OAuth error: ${err} — ${desc}`));
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        res.writeHead(400).end("missing code or state");
        reject(new Error("Salesforce did not return code/state"));
        return;
      }
      if (state !== expectedState) {
        res.writeHead(400).end("state mismatch");
        reject(new Error("OAuth state mismatch — possible CSRF"));
        return;
      }
      res
        .writeHead(200, { "Content-Type": "text/html" })
        .end(renderSuccessPage());
      resolve({
        result: { code, state },
        closeServer: () => server.close(),
      });
    });

    server.on("error", (err) => {
      reject(
        new Error(
          `Could not bind http://${CALLBACK_HOST}:${CALLBACK_PORT}: ${String(err)}. ` +
            `If 'next dev' is already running on this port, stop it and rerun sf:login.`
        )
      );
    });

    server.listen(CALLBACK_PORT, CALLBACK_HOST);
  });
}

function renderSuccessPage(): string {
  return `<!doctype html><html><head><title>Signed in</title>
<style>
body{background:#0b0d12;color:#e6e8eb;font-family:ui-sans-serif,system-ui;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.c{max-width:520px;padding:32px;border:1px solid #1f232c;border-radius:12px}
h1{margin:0 0 8px;font-size:20px;color:#7cd992}
p{margin:0;color:#9aa1ab;font-size:14px;line-height:1.5}
code{color:#e6e8eb;background:#11141b;padding:2px 6px;border-radius:4px}
</style></head><body><div class="c">
<h1>&#10003; Salesforce login complete</h1>
<p>You can close this tab and return to your terminal. Horizon has captured
your <code>mcp_api</code> token and is finishing up.</p>
</div></body></html>`;
}

function renderErrorPage(err: string, desc: string): string {
  return `<!doctype html><html><head><title>OAuth error</title>
<style>body{background:#0b0d12;color:#e6e8eb;font-family:ui-sans-serif,system-ui;padding:40px}
h1{color:#ff6b6b}</style></head><body>
<h1>OAuth error</h1><p><b>${err}</b></p><p>${desc}</p></body></html>`;
}

async function writeEnvUpdate(
  accessToken: string,
  instanceUrl: string
): Promise<void> {
  const envPath = path.resolve(process.cwd(), ".env");
  let contents = "";
  try {
    contents = await fs.readFile(envPath, "utf8");
  } catch {
    console.warn(
      `\n⚠️  Could not read ${envPath}. Skipping auto-update — copy the values manually.`
    );
    return;
  }
  contents = replaceEnvLine(contents, "SF_ACCESS_TOKEN", accessToken);
  contents = replaceEnvLine(contents, "SF_INSTANCE_URL", instanceUrl);
  await fs.writeFile(envPath, contents, "utf8");
}

function replaceEnvLine(src: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(src)) return src.replace(re, line);
  return src.endsWith("\n") ? src + line + "\n" : src + "\n" + line + "\n";
}

async function main() {
  if (!process.env.SF_CLIENT_ID || !process.env.SF_CLIENT_SECRET) {
    console.error(
      "\nMissing SF_CLIENT_ID or SF_CLIENT_SECRET in .env — populate the ECA credentials first.\n"
    );
    process.exit(2);
  }
  process.env.SF_REDIRECT_URI = REDIRECT_URI;

  const state = crypto.randomBytes(16).toString("hex");
  const { verifier, challenge } = generatePkce();
  const authorizeUrl = buildAuthorizeUrl({
    state,
    codeChallenge: challenge,
    redirectUri: REDIRECT_URI,
  });

  console.log("\nSalesforce login (OAuth 2.1 + PKCE)");
  console.log(`    Redirect URI: ${REDIRECT_URI}`);
  console.log(`    Scope:        ${SF_OAUTH_SCOPES}`);
  console.log("\n    Attempting to open your browser...");
  console.log("    If it doesn't open, copy+paste this URL into any browser:\n");
  console.log(`    ${authorizeUrl}\n`);
  console.log("    Waiting for the Salesforce redirect back to /callback...\n");

  const pending = waitForCallback(state);
  openBrowser(authorizeUrl);

  const { result, closeServer } = await pending;
  closeServer();

  console.log("    Authorization code received, exchanging for token...");
  const token = await exchangeCodeForToken({
    code: result.code,
    codeVerifier: verifier,
    redirectUri: REDIRECT_URI,
  });

  const scopes = token.scope ?? "(not returned)";
  console.log("\nSalesforce login complete.");
  console.log(`    Instance URL:  ${token.instance_url}`);
  console.log(`    Scopes:        ${scopes}`);
  console.log(`    Access token:  ${token.access_token.slice(0, 28)}...`);

  if (!scopes.includes("mcp_api")) {
    console.warn(
      "\n!!!  Token does NOT include the `mcp_api` scope. The Salesforce MCP\n" +
        "     gateway will reject it. Double-check the ECA's Selected OAuth Scopes."
    );
  }

  await writeEnvUpdate(token.access_token, token.instance_url);
  console.log("\nUpdated .env with SF_ACCESS_TOKEN + SF_INSTANCE_URL.");
  console.log("Next: npm run verify:mcp\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("\nsf-login failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
