import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMime, composeHtml, encodeHeader, formatAddress, htmlToText, pickReplyHeaders, pickSender, textToHtml, toRaw } from "./compose.js";

const LONG =
  "Thanks for confirming, and no problem about the junk folder. Good to know nothing more is needed from us and the credentials stay the same.";

function decodeParts(mime: string) {
  const parts: Record<string, string> = {};
  const re = /Content-Type: (text\/\w+); charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g;
  let m;
  while ((m = re.exec(mime))) parts[m[1]] = Buffer.from(m[2].replace(/\r\n/g, ""), "base64").toString("utf8");
  return parts;
}

test("a long sentence is never cut: one line in the HTML and in the plain part", () => {
  const html = composeHtml(textToHtml(`Hi Aneil,\n\n${LONG}`));
  const mime = buildMime({ to: "a@x.test", subject: "S", html, text: htmlToText(html), boundary: "B" });
  const p = decodeParts(mime);
  assert.ok(p["text/html"].includes(`<div>${LONG}</div>`));
  assert.ok(p["text/plain"].split("\n").includes(LONG), "plain part keeps the sentence on one line");
});

test("the message is multipart/alternative with an HTML part, so Gmail never opens it in Plain text mode", () => {
  const mime = buildMime({ to: "a@x.test", subject: "S", html: "<div>x</div>", text: "x", boundary: "B" });
  assert.match(mime, /Content-Type: multipart\/alternative; boundary="B"/);
  assert.match(mime, /Content-Type: text\/html; charset="UTF-8"/);
  assert.match(mime, /Content-Type: text\/plain; charset="UTF-8"/);
});

test("From, Cc and reply headers are written when given", () => {
  const mime = buildMime({
    from: "Varun <varun@chitly.co.uk>", to: "a@x.test", cc: "m@x.test", subject: "Re: S",
    html: "<div>x</div>", text: "x", inReplyTo: "<1@x>", references: "<0@x> <1@x>", boundary: "B",
  });
  assert.match(mime, /^From: Varun <varun@chitly\.co\.uk>\r\n/m);
  assert.match(mime, /^Cc: m@x\.test\r\n/m);
  assert.match(mime, /^In-Reply-To: <1@x>\r\n/m);
  assert.match(mime, /^References: <0@x> <1@x>\r\n/m);
});

test("the signature goes after the body in Gmail's signature block", () => {
  const html = composeHtml("<div>Body</div>", "<div>Varun</div>");
  assert.equal(html, '<div dir="ltr"><div>Body</div><br><div dir="ltr" class="gmail_signature"><div>Varun</div></div></div>');
  assert.equal(composeHtml("<div>Body</div>"), '<div dir="ltr"><div>Body</div></div>');
});

test("blank lines between paragraphs are kept, and text is escaped", () => {
  assert.equal(textToHtml("a & b\n\n<c>"), "<div>a &amp; b</div><div><br></div><div>&lt;c&gt;</div>");
  assert.equal(htmlToText("<div>a &amp; b</div><div><br></div><div>c</div>"), "a & b\n\nc");
});

test("a non-ASCII subject is encoded, an ASCII one is left alone", () => {
  assert.equal(encodeHeader("Hello"), "Hello");
  assert.equal(encodeHeader("£69"), `=?UTF-8?B?${Buffer.from("£69").toString("base64")}?=`);
});

test("raw output is URL-safe base64 for the Gmail API", () => {
  const raw = toRaw("From: a\r\n\r\n???>>>");
  assert.doesNotMatch(raw, /[+/=]/);
});

test("a line break in any header field is refused (no hidden Bcc)", () => {
  const base = { to: "a@x.test", subject: "S", html: "<div>x</div>", text: "x" };
  assert.throws(() => buildMime({ ...base, to: "a@x.test\r\nBcc: evil@x.test" }), /to field must not contain a line break/);
  assert.throws(() => buildMime({ ...base, subject: "Hi\nBcc: evil@x.test" }), /subject field/);
  assert.throws(() => buildMime({ ...base, cc: "b@x.test\nX: y" }), /cc field/);
  assert.doesNotThrow(() => buildMime({ ...base, html: "<div>a</div>\n<div>b</div>", text: "a\nb" }));
});

const SENDAS = [
  { sendAsEmail: "me@gmail.test", isDefault: true, signature: "" },
  { sendAsEmail: "varun@chitly.co.uk", displayName: "Varun", signature: "<div>Varun sig</div>" },
  { sendAsEmail: "team@chitly.co.uk", displayName: "Varun at Chitly", signature: "" },
];

test("from must be one of the send-as addresses, any case; its display name and signature are used", () => {
  assert.deepEqual(pickSender(SENDAS, "VARUN@chitly.co.uk"), { header: "Varun <varun@chitly.co.uk>", signature: "<div>Varun sig</div>" });
  assert.deepEqual(pickSender(SENDAS, "team@chitly.co.uk"), { header: "Varun at Chitly <team@chitly.co.uk>", signature: "" });
  assert.deepEqual(pickSender(SENDAS), { header: "me@gmail.test", signature: "" });
  assert.throws(() => pickSender(SENDAS, "someone@else.test"), /not a send-as address.*varun@chitly\.co\.uk/);
});

test("display names with commas, quotes or non-ASCII are made safe", () => {
  assert.equal(formatAddress("Smith, Varun", "a@x.test"), '"Smith, Varun" <a@x.test>');
  assert.equal(formatAddress('A "B" C', "a@x.test"), '"A \\"B\\" C" <a@x.test>');
  assert.match(formatAddress("Zoë", "a@x.test"), /^=\?UTF-8\?B\?.+\?= <a@x\.test>$/);
  assert.equal(formatAddress(undefined, "a@x.test"), "a@x.test");
});

test("reply headers point at the newest sent message, skip drafts, and don't repeat ids", () => {
  const msg = (id: string, date: string, refs = "", labels: string[] = []) => ({
    labelIds: labels, internalDate: date,
    payload: { headers: [{ name: "Message-Id", value: id }, ...(refs ? [{ name: "References", value: refs }] : [])] },
  });
  const r = pickReplyHeaders([
    msg("<2@x>", "200", "<1@x>"),
    msg("<1@x>", "100"),
    msg("<draft@x>", "300", "", ["DRAFT"]),
  ]);
  assert.deepEqual(r, { inReplyTo: "<2@x>", references: "<1@x> <2@x>" });
  assert.deepEqual(pickReplyHeaders([msg("<3@x>", "1", "<1@x> <3@x>")]), { inReplyTo: "<3@x>", references: "<1@x> <3@x>" });
  assert.deepEqual(pickReplyHeaders([]), {});
});

test("plain copy keeps link targets and list items, and drops style blocks", () => {
  const t = htmlToText('<style>p{color:red}</style><div>See <a href="https://chitly.co.uk/x?a=1&amp;b=2">our prices</a></div><ul><li>One</li><li>Two</li></ul><div><a href="mailto:t@x.test">t@x.test</a></div>');
  assert.equal(t, "See our prices (https://chitly.co.uk/x?a=1&b=2)\n- One\n- Two\nt@x.test");
});

test("signature is optional: no signature block when there is none", () => {
  const html = composeHtml(textToHtml("Hi"), undefined);
  assert.doesNotMatch(html, /gmail_signature/);
});
