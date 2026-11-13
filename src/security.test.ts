import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import { fileURLToPath } from "node:url";
import { buildMime } from "./compose.js";
import {
  REQUIRED_SCOPES,
  checkGrant,
  checkState,
  clampLimit,
  listenLocal,
  matchAccount,
  readTokenJson,
  resolveSingleTokenFile,
  resolveTokenFilesIn,
  validateDraftArgs,
  validateEmailArg,
  writeTokenFile,
} from "./security.js";

const base = { subject: "S", html: "<div>x</div>", text: "x", boundary: "B" };
const SCOPE_STRING = REQUIRED_SCOPES.join(" ");

test("1. an array or object recipient is rejected by buildMime, and a CRLF string still is", () => {
  const evil = "a@x.com\r\nBcc: e@x.com";
  assert.throws(() => buildMime({ ...base, to: [evil] as any }), /single string/);
  assert.throws(() => buildMime({ ...base, to: { 0: evil } as any }), /single string/);
  assert.throws(() => buildMime({ ...base, to: evil }), /line break/);
});

test("2. every non-string draft field is rejected at the tool boundary with a clear message", () => {
  for (const f of ["account", "draftId", "to", "subject", "body", "html", "from", "cc", "bcc", "threadId"]) {
    assert.throws(() => validateDraftArgs({ [f]: ["x"] }), new RegExp(`The ${f} field must be a single string, not an array`));
    assert.throws(() => validateDraftArgs({ [f]: { a: 1 } }), new RegExp(`The ${f} field must be a single string, not an object`));
    assert.throws(() => validateDraftArgs({ [f]: 5 }), new RegExp(`The ${f} field`));
  }
  assert.throws(() => validateDraftArgs({ signature: "yes" }), /signature/);
  const ok = validateDraftArgs({ to: "a@x.com", subject: "S", signature: false });
  assert.deepEqual(ok, { to: "a@x.com", subject: "S", signature: false });
});

test("3. account matching is exact and case-insensitive, never a prefix", () => {
  const accounts = ["varun@example.com", "other@example.com"];
  assert.equal(matchAccount(accounts, "varun"), undefined);
  assert.equal(matchAccount(accounts, "Varun@Example.com"), "varun@example.com");
});

test("4. checkGrant refuses another account, a missing scope and an extra scope, and accepts exactly the three", () => {
  assert.doesNotThrow(() => checkGrant("Varun@Example.com", "varun@example.com", SCOPE_STRING));
  assert.throws(() => checkGrant("other@example.com", "varun@example.com", SCOPE_STRING), /not the requested account/);
  assert.throws(() => checkGrant("varun@example.com", "varun@example.com", REQUIRED_SCOPES.slice(0, 2).join(" ")), /Missing/);
  assert.throws(
    () => checkGrant("varun@example.com", "varun@example.com", `${SCOPE_STRING} https://mail.google.com/`),
    /Unexpected: https:\/\/mail\.google\.com\//
  );
  assert.throws(() => checkGrant("varun@example.com", "varun@example.com", undefined), /Missing/);
});

test("5. checkState refuses a mismatched or missing state", () => {
  assert.doesNotThrow(() => checkState("abc", "abc"));
  assert.throws(() => checkState("abc", "abd"), /state/);
  assert.throws(() => checkState("abc", null), /state/);
  assert.throws(() => checkState("abc", ""), /state/);
});

test("6. validateEmailArg refuses path tricks and empty input", () => {
  for (const bad of ["../x", "a/b@x.com", "a\\b@x.com", "", undefined, "a..b@x.com"]) {
    assert.throws(() => validateEmailArg(bad), /plain email address/);
  }
  assert.equal(validateEmailArg("varun@example.com"), "varun@example.com");
});

test("7. the token file is written 0o600 inside a 0o700 directory", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gmcp-"));
  try {
    const dir = path.join(tmp, "tokens");
    const file = writeTokenFile(dir, "varun@example.com", { refresh_token: "x" });
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("8. a corrupt token file gives an error that names the account and holds none of the file's bytes", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gmcp-"));
  try {
    const f = path.join(tmp, "varun@example.com.json");
    fs.writeFileSync(f, '{"refresh_token": SECRETBYTES123 oops');
    let msg = "";
    try {
      readTokenJson(f, "varun@example.com");
    } catch (e: any) {
      msg = e.message;
    }
    assert.ok(msg.includes("varun@example.com"));
    assert.ok(!msg.includes("SECRETBYTES123"));
    assert.ok(!msg.includes("refresh_token"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("9. limits above 100 clamp to 100 and below 1 clamp to 1", () => {
  assert.equal(clampLimit(500), 100);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(-7), 1);
  assert.equal(clampLimit(undefined), 50);
  assert.equal(clampLimit("9999" as any), 50);
  assert.equal(clampLimit(25), 25);
});

test("10. the auth server binds 127.0.0.1 only", async () => {
  const server = http.createServer();
  await new Promise<void>((resolve) => listenLocal(server, 0, resolve));
  try {
    assert.equal((server.address() as any).address, "127.0.0.1");
  } finally {
    await new Promise((r) => server.close(r));
  }
  const authJs = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "auth.js"), "utf8");
  assert.match(authJs, /listenLocal\(server/);
  assert.doesNotMatch(authJs, /server\.listen\(/);
});

function tokenDir(names: string[]): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gmcp-acct-"));
  for (const n of names) fs.writeFileSync(path.join(d, `${n}.json`), JSON.stringify({ refresh_token: "x" }));
  return d;
}

test("11. ALL, All, ' all ' and empty are refused for drafts; an exact address in another case resolves to one account", () => {
  const d = tokenDir(["first@example.com", "varun@example.com"]);
  for (const a of ["ALL", "All", " all ", "", "all"]) {
    assert.throws(() => resolveSingleTokenFile(d, a), /account is required for drafts/, `account ${JSON.stringify(a)}`);
  }
  assert.equal(resolveSingleTokenFile(d, "VARUN@Example.com"), path.join(d, "varun@example.com.json"));
  assert.throws(() => resolveSingleTokenFile(d, "varun"), /No token for account/);
});

test("12. a symlink planted at the token path is not followed and an error is thrown", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gmcp-link-"));
  const victim = path.join(d, "victim.txt");
  fs.writeFileSync(victim, "original");
  const tokens = path.join(d, "tokens");
  fs.mkdirSync(tokens);
  fs.symlinkSync(victim, path.join(tokens, "a@example.com.json"));
  assert.throws(() => writeTokenFile(tokens, "a@example.com", { refresh_token: "secret" }), /symbolic link/);
  assert.equal(fs.readFileSync(victim, "utf8"), "original");
  assert.deepEqual(fs.readdirSync(tokens), ["a@example.com.json"]);
});

test("13. two resolveTokenFilesIn calls do not share skipped notes", () => {
  const d = tokenDir(["good@example.com"]);
  fs.writeFileSync(path.join(d, "bad@example.com.json"), "not json");
  const first = resolveTokenFilesIn(d);
  assert.deepEqual(first.skipped, ["bad@example.com"]);
  assert.equal(first.files.length, 1);
  const second = resolveTokenFilesIn(d, "good@example.com");
  assert.deepEqual(second.skipped, []);
  const clean = resolveTokenFilesIn(tokenDir(["good@example.com"]));
  assert.deepEqual(clean.skipped, []);
  assert.deepEqual(first.skipped, ["bad@example.com"]);
});

test("14. create_draft refuses a missing to or subject with a clear message", () => {
  assert.throws(() => validateDraftArgs({ account: "a@x.com", subject: "S" }, "create_draft"), /to field is required/);
  assert.throws(() => validateDraftArgs({ account: "a@x.com", to: "b@x.com" }, "create_draft"), /subject field is required/);
  assert.throws(() => validateDraftArgs({ to: "b@x.com", subject: "  " }, "create_draft"), /subject field is required/);
  assert.equal(validateDraftArgs({ to: "b@x.com", subject: "S" }, "create_draft").to, "b@x.com");
  assert.doesNotThrow(() => validateDraftArgs({ draftId: "d1", body: "b" }, "update_draft"));
});

test("15. checkState behaves as before with equal and unequal lengths", () => {
  assert.doesNotThrow(() => checkState("abc123", "abc123"));
  assert.throws(() => checkState("abc123", "abc124"), /state/);
  assert.throws(() => checkState("abc123", "abc12"), /state/);
  assert.throws(() => checkState("abc123", "abc1234"), /state/);
  assert.throws(() => checkState("abc123", null), /state/);
  assert.throws(() => checkState("abc123", ""), /state/);
});
