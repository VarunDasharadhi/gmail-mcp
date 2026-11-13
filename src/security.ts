import { readFileSync, readdirSync, existsSync, mkdirSync, chmodSync, lstatSync, openSync, writeSync, closeSync, renameSync, unlinkSync, constants as fsc } from "fs";
import { join } from "path";
import { randomBytes, timingSafeEqual } from "crypto";
import type * as http from "http";

export const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export const AUTH_HOST = "127.0.0.1";

/** Draft fields that must be a string when present. `signature` is the one boolean and is checked separately. */
export const DRAFT_STRING_FIELDS = [
  "account",
  "draftId",
  "to",
  "subject",
  "body",
  "html",
  "from",
  "cc",
  "bcc",
  "threadId",
] as const;

export interface DraftArgs {
  account?: string;
  draftId?: string;
  to?: string;
  subject?: string;
  body?: string;
  html?: string;
  from?: string;
  cc?: string;
  bcc?: string;
  threadId?: string;
  signature?: boolean;
}

/** Check draft tool arguments at the boundary: each field is a string (or absent). Arrays and objects are refused. */
export function validateDraftArgs(args: Record<string, unknown> | undefined, tool: "create_draft" | "update_draft" = "update_draft"): DraftArgs {
  const a = args ?? {};
  if (tool === "create_draft") {
    for (const k of ["to", "subject"] as const) {
      const v = a[k];
      if (typeof v !== "string" || v.trim() === "") {
        throw new Error(`The ${k} field is required for create_draft and must be a non-empty string.`);
      }
    }
  }
  for (const k of DRAFT_STRING_FIELDS) {
    const v = a[k];
    if (v !== undefined && v !== null && typeof v !== "string") {
      const kind = Array.isArray(v) ? "an array" : typeof v === "object" ? "an object" : `a ${typeof v}`;
      throw new Error(`The ${k} field must be a single string, not ${kind}.`);
    }
  }
  const sig = a.signature;
  if (sig !== undefined && sig !== null && typeof sig !== "boolean") {
    throw new Error("The signature field must be true or false.");
  }
  const out: Record<string, unknown> = {};
  for (const k of DRAFT_STRING_FIELDS) if (typeof a[k] === "string") out[k] = a[k];
  if (typeof sig === "boolean") out.signature = sig;
  return out as DraftArgs;
}

/** Clamp a "max results" argument to 1..100. Missing or non-numeric values give the default. */
export function clampLimit(v: unknown, fallback = 50): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.min(100, Math.max(1, n));
}

/** Exact, case-insensitive match on the full address. No prefix matching. */
export function matchAccount(accounts: string[], account: string): string | undefined {
  if (typeof account !== "string") return undefined;
  const want = account.toLowerCase();
  return accounts.find((a) => a.toLowerCase() === want);
}

/** Read and parse a token file. On any failure the error names the account and never carries file content. */
export function readTokenJson(tokenFile: string, account: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(tokenFile, "utf8"));
  } catch {
    parsed = undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `The token file for account "${account}" (tokens/${account}.json) is unreadable or corrupt. Run: npm run auth -- ${account}`
    );
  }
  return parsed as Record<string, unknown>;
}

export function generateState(): string {
  return randomBytes(24).toString("hex");
}

export function checkState(expected: string, received: string | null | undefined): void {
  const e = Buffer.from(expected ?? "", "utf8");
  const r = Buffer.from(received ?? "", "utf8");
  if (!expected || !received || e.length !== r.length || !timingSafeEqual(e, r)) {
    throw new Error("The authorization callback did not carry the expected state, so it was ignored.");
  }
}

/** Refuse to save a token unless it belongs to the requested account and carries exactly the three scopes. */
export function checkGrant(profileEmail: string | null | undefined, requestedEmail: string, scopeString: string | null | undefined): void {
  if (!profileEmail || profileEmail.toLowerCase() !== requestedEmail.toLowerCase()) {
    throw new Error(
      `The signed-in Google account (${profileEmail ?? "unknown"}) is not the requested account (${requestedEmail}). Nothing was saved.`
    );
  }
  const granted = new Set((scopeString ?? "").split(/\s+/).filter(Boolean));
  const want = new Set(REQUIRED_SCOPES);
  const missing = [...want].filter((s) => !granted.has(s));
  const extra = [...granted].filter((s) => !want.has(s));
  if (missing.length || extra.length) {
    throw new Error(
      `The granted scopes do not match what this server needs. Missing: ${missing.join(", ") || "none"}. Unexpected: ${extra.join(", ") || "none"}. Nothing was saved.`
    );
  }
}

const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** A plain address, safe to use as a file name: no slashes, backslashes or "..". */
export function validateEmailArg(email: unknown): string {
  if (
    typeof email !== "string" ||
    email.length === 0 ||
    email.length > 254 ||
    /[\/\\]/.test(email) ||
    email.includes("..") ||
    !EMAIL_RE.test(email)
  ) {
    throw new Error("Give a plain email address, for example: npm run auth -- name@gmail.com");
  }
  return email;
}

/** Write a token file the owner alone can read: directory 0o700, file 0o600. Writes a temp file with O_EXCL|O_NOFOLLOW in the same dir, then renames over the target. Refuses a symlink at the target. */
export function writeTokenFile(tokensDir: string, email: string, tokens: unknown): string {
  validateEmailArg(email);
  mkdirSync(tokensDir, { recursive: true, mode: 0o700 });
  chmodSync(tokensDir, 0o700);
  const path = join(tokensDir, `${email}.json`);
  let st;
  try {
    st = lstatSync(path);
  } catch {
    st = undefined;
  }
  if (st && st.isSymbolicLink()) {
    throw new Error(`Refusing to write: tokens/${email}.json is a symbolic link. Nothing was saved.`);
  }
  const tmp = join(tokensDir, `.${email}.${randomBytes(8).toString("hex")}.tmp`);
  const fd = openSync(tmp, fsc.O_CREAT | fsc.O_EXCL | fsc.O_WRONLY | fsc.O_NOFOLLOW, 0o600);
  try {
    writeSync(fd, JSON.stringify(tokens, null, 2));
  } catch (e) {
    closeSync(fd);
    try { unlinkSync(tmp); } catch {}
    throw e;
  }
  closeSync(fd);
  chmodSync(tmp, 0o600);
  try {
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch {}
    throw e;
  }
  return path;
}

/** List account names (token file stems) in a tokens directory. Temp files start with a dot and end in .tmp, so they never match. */
export function listAccountsIn(tokensDir: string): string[] {
  if (!existsSync(tokensDir)) return [];
  return readdirSync(tokensDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

/** True when the account argument means "every account": missing, empty, or any case of "all" with spaces. */
export function isAllAccounts(account: unknown): boolean {
  return account === undefined || account === null || (typeof account === "string" && (account.trim() === "" || account.trim().toLowerCase() === "all"));
}

/** Resolve token files for one call. Returns the files and, separately, the accounts skipped as unreadable (no shared state). */
export function resolveTokenFilesIn(tokensDir: string, account?: unknown): { files: string[]; skipped: string[] } {
  if (account !== undefined && account !== null && typeof account !== "string") throw new Error("account must be a string.");
  const accounts = listAccountsIn(tokensDir);
  if (isAllAccounts(account)) {
    const files: string[] = [];
    const skipped: string[] = [];
    for (const a of accounts) {
      const f = join(tokensDir, `${a}.json`);
      try {
        readTokenJson(f, a);
        files.push(f);
      } catch {
        skipped.push(a);
      }
    }
    return { files, skipped };
  }
  const match = matchAccount(accounts, account as string);
  if (!match) throw new Error(`No token for account "${account}". Run: npm run auth -- ${account}`);
  const f = join(tokensDir, `${match}.json`);
  readTokenJson(f, match);
  return { files: [f], skipped: [] };
}

/** Draft tools need exactly one account. "all" in any case, blank or missing is refused; otherwise one exact match. */
export function resolveSingleTokenFile(tokensDir: string, account: unknown): string {
  if (typeof account !== "string" || isAllAccounts(account)) {
    throw new Error("account is required for drafts: pick one address from list_accounts");
  }
  const { files } = resolveTokenFilesIn(tokensDir, account.trim());
  if (files.length !== 1) throw new Error("Exactly one account must match for drafts.");
  return files[0];
}

/** Bind the OAuth callback server to loopback only. */
export function listenLocal(server: http.Server, port: number, cb?: () => void): http.Server {
  return server.listen(port, AUTH_HOST, cb);
}
