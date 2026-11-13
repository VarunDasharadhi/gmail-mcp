// Pure helpers for building draft messages. No network, no credentials, so they can be tested alone.
//
// Why this exists (Varun, 12 Nov 2026): plain-text drafts open in Gmail's Plain text mode, and Gmail
// hard-wraps those at about 70 characters on send, so sentences arrive cut in half. Every draft is
// now multipart/alternative with an HTML part, and neither part is ever wrapped.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain text to Gmail-style HTML: one <div> per line, blank lines kept, nothing wrapped or width-capped. */
export function textToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines.map((l) => (l.trim() === "" ? "<div><br></div>" : `<div>${escapeHtml(l)}</div>`)).join("");
}

/** Rough HTML to text for the plain alternative part. Paragraph breaks kept, no wrapping. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|title|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, "").trim();
      const url = href.replace(/^mailto:/i, "").replace(/&amp;/g, "&");
      return !label || label === url || url.startsWith("tel:") ? label || url : `${label} (${url})`;
    })
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** RFC 2047 encode a header value only when it has non-ASCII characters. */
export function encodeHeader(v: string): string {
  return /^[\x00-\x7f]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

/** A display name plus address for a From header: RFC 2047 if non-ASCII, quoted if it has specials. */
export function formatAddress(name: string | undefined, email: string): string {
  if (!name) return email;
  if (!/^[\x00-\x7f]*$/.test(name)) return `${encodeHeader(name)} <${email}>`;
  if (/[()<>@,;:\\".\[\]]/.test(name)) return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
  return `${name} <${email}>`;
}

export interface SendAs {
  sendAsEmail?: string | null;
  displayName?: string | null;
  signature?: string | null;
  isDefault?: boolean | null;
}

/** Pick the From from the account's send-as list (exact address, any case) or its default. Refuses anything else. */
export function pickSender(list: SendAs[], from?: string): { header: string; signature: string } {
  const want = (from ?? "").trim().toLowerCase();
  const match = want ? list.find((s) => (s.sendAsEmail ?? "").toLowerCase() === want) : list.find((s) => s.isDefault);
  if (!match || !match.sendAsEmail) {
    const known = list.map((s) => s.sendAsEmail).join(", ");
    throw new Error(`"${from ?? "(default)"}" is not a send-as address on this account. Use one of: ${known}`);
  }
  return { header: formatAddress(match.displayName ?? undefined, match.sendAsEmail), signature: match.signature || "" };
}

export interface ThreadMsg {
  labelIds?: string[] | null;
  internalDate?: string | null;
  payload?: { headers?: { name?: string | null; value?: string | null }[] | null } | null;
}

/** In-Reply-To and References for a reply: the newest message in the thread that is not a draft. */
export function pickReplyHeaders(messages: ThreadMsg[]): { inReplyTo?: string; references?: string } {
  const sent = messages
    .filter((m) => !(m.labelIds ?? []).includes("DRAFT"))
    .sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
  const last = sent[sent.length - 1];
  const hs = last?.payload?.headers ?? [];
  const get = (n: string) => hs.find((h) => (h.name ?? "").toLowerCase() === n.toLowerCase())?.value ?? "";
  const id = get("Message-ID").trim();
  if (!id) return {};
  const refs = get("References").trim();
  const list = refs.split(/\s+/).filter(Boolean).filter((r) => r !== id);
  return { inReplyTo: id, references: [...list, id].join(" ") };
}

/** Base64 body split at 76 characters. This wraps the encoding only, never the text the reader sees. */
function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
}

export interface MimeParams {
  from?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  text: string;
  inReplyTo?: string;
  references?: string;
  boundary?: string;
}

export function buildMime(p: MimeParams): string {
  // A line break inside any header value would let a caller add headers (a hidden Bcc, say). Refuse it.
  for (const [k, v] of Object.entries(p)) {
    if (k !== "html" && k !== "text" && typeof v === "string" && /[\r\n]/.test(v)) {
      throw new Error(`The ${k} field must not contain a line break.`);
    }
  }
  const boundary = p.boundary ?? `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const h: string[] = [];
  if (p.from) h.push(`From: ${p.from}`);
  h.push(`To: ${p.to}`);
  if (p.cc) h.push(`Cc: ${p.cc}`);
  if (p.bcc) h.push(`Bcc: ${p.bcc}`);
  h.push(`Subject: ${encodeHeader(p.subject)}`);
  if (p.inReplyTo) h.push(`In-Reply-To: ${p.inReplyTo}`);
  if (p.references) h.push(`References: ${p.references}`);
  h.push("MIME-Version: 1.0");
  h.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const part = (type: string, body: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(body)}\r\n`;
  return `${h.join("\r\n")}\r\n\r\n${part("text/plain", p.text)}${part("text/html", p.html)}--${boundary}--\r\n`;
}

export function toRaw(mime: string): string {
  return Buffer.from(mime, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The HTML body: the message, then the send-as signature if there is one, in Gmail's own markup. */
export function composeHtml(bodyHtml: string, signatureHtml?: string): string {
  const sig = signatureHtml ? `<br><div dir="ltr" class="gmail_signature">${signatureHtml}</div>` : "";
  return `<div dir="ltr">${bodyHtml}${sig}</div>`;
}
