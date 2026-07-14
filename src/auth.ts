import { google } from "googleapis";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CREDENTIALS_PATH = join(ROOT, "credentials.json");
const TOKENS_DIR = join(ROOT, "tokens");
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];
const PORT = 9427;
const REDIRECT_URI = `http://localhost:${PORT}`;

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run auth -- <email@gmail.com>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
const creds = raw.installed ?? raw.web;

// Use localhost:3000 as redirect — for Desktop (installed) app credentials,
// Google accepts any localhost port even if credentials.json lists plain http://localhost.
const client = new google.auth.OAuth2(creds.client_id, creds.client_secret, REDIRECT_URI);

const authUrl = client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
  login_hint: email,
});

console.log(`\nAuthorizing: ${email}`);
console.log("\nOpen this URL in a browser:\n");
console.log(authUrl);
console.log(`\nWaiting for Google to redirect back to http://localhost:${PORT} ...\n`);

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/")) {
    res.end("Waiting...");
    return;
  }

  const params = new URL(req.url, REDIRECT_URI).searchParams;
  const code = params.get("code");
  const error = params.get("error");

  if (error) {
    res.writeHead(400);
    res.end(`Authorization failed: ${error}`);
    console.error(`\nAuthorization failed: ${error}\n`);
    server.close(() => process.exit(1));
    return;
  }

  if (!code) {
    res.end("Waiting...");
    return;
  }

  try {
    const { tokens } = await client.getToken(code);
    mkdirSync(TOKENS_DIR, { recursive: true });
    const tokenPath = join(TOKENS_DIR, `${email}.json`);
    writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      `<h2 style="font-family:sans-serif">Done! Authorized ${email}.</h2>` +
      `<p style="font-family:sans-serif">You can close this tab and return to the terminal.</p>`
    );

    console.log(`Token saved: tokens/${email}.json`);
    console.log("Close the browser tab and run the next account.\n");
    server.close(() => process.exit(0));
  } catch (err: any) {
    res.writeHead(500);
    res.end(`Error: ${err.message}`);
    console.error(`\nFailed to exchange token: ${err.message}\n`);
    server.close(() => process.exit(1));
  }
});

server.listen(PORT, () => {
  console.log(`Local server listening on http://localhost:${PORT}`);
  console.log("(Open the URL above in your browser — the rest is automatic)\n");
});
