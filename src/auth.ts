import { google } from "googleapis";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as http from "http";
import { REQUIRED_SCOPES, checkGrant, checkState, generateState, listenLocal, validateEmailArg, writeTokenFile } from "./security.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CREDENTIALS_PATH = join(ROOT, "credentials.json");
const TOKENS_DIR = join(ROOT, "tokens");
const PORT = 9427;
// The callback server listens on loopback only, so the redirect points at the loopback address too.
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

let email: string;
try {
  email = validateEmailArg(process.argv[2]);
} catch {
  console.error("Usage: npm run auth -- <email@gmail.com>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
const creds = raw.installed ?? raw.web;

// For Desktop (installed) app credentials, Google accepts any loopback port as the redirect,
// even if credentials.json lists plain http://localhost.
const client = new google.auth.OAuth2(creds.client_id, creds.client_secret, REDIRECT_URI);

// A fresh random state per run: a callback that does not carry it is ignored.
const state = generateState();

const authUrl = client.generateAuthUrl({
  access_type: "offline",
  scope: REQUIRED_SCOPES,
  prompt: "consent",
  login_hint: email,
  state,
});

console.log(`\nAuthorizing: ${email}`);
console.log("\nOpen this URL in a browser on this same machine (the callback only listens on 127.0.0.1):\n");
console.log(authUrl);
console.log(`\nWaiting for Google to redirect back to ${REDIRECT_URI} ...\n`);

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/")) {
    res.end("Waiting...");
    return;
  }

  const params = new URL(req.url, REDIRECT_URI).searchParams;
  const code = params.get("code");
  const error = params.get("error");

  if (!code && !error) {
    res.end("Waiting...");
    return;
  }

  try {
    checkState(state, params.get("state"));
  } catch (err: any) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Rejected: this request did not come from the authorization started by the terminal.");
    console.error(`\n${err.message}\n`);
    return;
  }

  if (error) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Authorization failed. See the terminal.");
    console.error(`\nAuthorization failed: ${error}\n`);
    server.close(() => process.exit(1));
    return;
  }

  try {
    const { tokens } = await client.getToken(code!);
    client.setCredentials(tokens);
    const profile = await google.gmail({ version: "v1", auth: client }).users.getProfile({ userId: "me" });
    checkGrant(profile.data.emailAddress, email, tokens.scope);

    writeTokenFile(TOKENS_DIR, email, tokens);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      `<h2 style="font-family:sans-serif">Done! Authorized an account.</h2>` +
      `<p style="font-family:sans-serif">You can close this tab and return to the terminal.</p>`
    );

    console.log(`Token saved: tokens/${email}.json`);
    console.log("Close the browser tab and run the next account.\n");
    server.close(() => process.exit(0));
  } catch (err: any) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Authorization could not be completed. See the terminal.");
    console.error(`\nFailed to authorize: ${err.message}\n`);
    server.close(() => process.exit(1));
  }
});

listenLocal(server, PORT, () => {
  console.log(`Local server listening on ${REDIRECT_URI}`);
  console.log("(Open the URL above in a browser on this machine; the rest is automatic)\n");
});
