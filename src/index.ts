import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CREDENTIALS_PATH = join(ROOT, "credentials.json");
const TOKENS_DIR = join(ROOT, "tokens");

function loadOAuthBase(): { client_id: string; client_secret: string; redirect_uris: string[] } {
  const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
  return raw.installed ?? raw.web;
}

function getClient(tokenFile: string): OAuth2Client {
  const creds = loadOAuthBase();
  const client = new google.auth.OAuth2(creds.client_id, creds.client_secret, creds.redirect_uris[0]);
  client.setCredentials(JSON.parse(readFileSync(tokenFile, "utf8")));
  return client;
}

function listAccounts(): string[] {
  if (!existsSync(TOKENS_DIR)) return [];
  return readdirSync(TOKENS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

function resolveTokenFiles(account?: string): string[] {
  const accounts = listAccounts();
  if (!account || account === "all") {
    return accounts.map((a) => join(TOKENS_DIR, `${a}.json`));
  }
  const match = accounts.find((a) => a === account || a.startsWith(account));
  if (!match) throw new Error(`No token for account "${account}". Run: npm run auth -- ${account}`);
  return [join(TOKENS_DIR, `${match}.json`)];
}

function accountFromPath(tokenFile: string): string {
  return tokenFile.split(/[/\\]/).pop()!.replace(".json", "");
}

function extractHeader(headers: any[], name: string): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return Buffer.from(payload.body.data, "base64").toString("utf8");
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain") {
        const body = extractBody(part);
        if (body) return body;
      }
    }
    for (const part of payload.parts) {
      const body = extractBody(part);
      if (body) return body;
    }
  }
  return "";
}

async function searchThreads(query: string, maxResults: number, account?: string) {
  const tokenFiles = resolveTokenFiles(account);
  const results: any[] = [];
  const seenIds = new Set<string>();

  for (const tokenFile of tokenFiles) {
    const email = accountFromPath(tokenFile);
    const gmail = google.gmail({ version: "v1", auth: getClient(tokenFile) });

    try {
      const listRes = await gmail.users.threads.list({ userId: "me", q: query, maxResults });
      const threads = listRes.data.threads ?? [];

      for (const thread of threads) {
        if (!thread.id || seenIds.has(thread.id)) continue;
        seenIds.add(thread.id);

        const threadRes = await gmail.users.threads.get({
          userId: "me",
          id: thread.id,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "To", "Date"],
        });

        results.push({
          id: thread.id,
          account: email,
          messages: (threadRes.data.messages ?? []).map((msg) => {
            const h = msg.payload?.headers ?? [];
            return {
              id: msg.id,
              threadId: msg.threadId,
              labelIds: msg.labelIds,
              snippet: msg.snippet,
              date: extractHeader(h, "Date"),
              subject: extractHeader(h, "Subject"),
              sender: extractHeader(h, "From"),
              toRecipients: [extractHeader(h, "To")],
              account: email,
            };
          }),
        });
      }
    } catch (err: any) {
      results.push({ account: email, error: err.message });
    }
  }

  return results;
}

async function getMessage(messageId: string, account?: string) {
  const tokenFiles = resolveTokenFiles(account);

  for (const tokenFile of tokenFiles) {
    const email = accountFromPath(tokenFile);
    const gmail = google.gmail({ version: "v1", auth: getClient(tokenFile) });

    try {
      const res = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
      const h = res.data.payload?.headers ?? [];
      return {
        id: res.data.id,
        threadId: res.data.threadId,
        labelIds: res.data.labelIds,
        snippet: res.data.snippet,
        subject: extractHeader(h, "Subject"),
        sender: extractHeader(h, "From"),
        date: extractHeader(h, "Date"),
        body: extractBody(res.data.payload),
        account: email,
      };
    } catch {
      continue;
    }
  }

  throw new Error(`Message ${messageId} not found in any connected account`);
}

async function listLabels(account?: string) {
  const tokenFiles = resolveTokenFiles(account);
  const results: any[] = [];

  for (const tokenFile of tokenFiles) {
    const email = accountFromPath(tokenFile);
    const gmail = google.gmail({ version: "v1", auth: getClient(tokenFile) });

    try {
      const res = await gmail.users.labels.list({ userId: "me" });
      results.push({
        account: email,
        labels: (res.data.labels ?? []).map((l) => ({ id: l.id, name: l.name })),
      });
    } catch (err: any) {
      results.push({ account: email, error: err.message });
    }
  }

  return results;
}

function buildRawMessage(params: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}): string {
  const headers = [`To: ${params.to}`];
  if (params.cc) headers.push(`Cc: ${params.cc}`);
  if (params.bcc) headers.push(`Bcc: ${params.bcc}`);
  headers.push(`Subject: ${params.subject}`);
  headers.push(`MIME-Version: 1.0`);
  headers.push(`Content-Type: text/plain; charset="UTF-8"`);

  const raw = `${headers.join("\r\n")}\r\n\r\n${params.body}`;
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createDraft(
  account: string,
  to: string,
  subject: string,
  body: string,
  cc?: string,
  bcc?: string,
  threadId?: string
) {
  if (!account || account === "all") {
    throw new Error("account is required for create_draft — pick one from list_accounts");
  }

  const tokenFile = resolveTokenFiles(account)[0];
  const email = accountFromPath(tokenFile);
  const gmail = google.gmail({ version: "v1", auth: getClient(tokenFile) });

  const raw = buildRawMessage({ to, subject, body, cc, bcc });
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw, threadId } },
  });

  return {
    draftId: res.data.id,
    messageId: res.data.message?.id,
    threadId: res.data.message?.threadId,
    account: email,
  };
}

async function listDrafts(maxResults: number, account?: string) {
  const tokenFiles = resolveTokenFiles(account);
  const results: any[] = [];

  for (const tokenFile of tokenFiles) {
    const email = accountFromPath(tokenFile);
    const gmail = google.gmail({ version: "v1", auth: getClient(tokenFile) });

    try {
      const listRes = await gmail.users.drafts.list({ userId: "me", maxResults });
      const drafts = listRes.data.drafts ?? [];

      const detailed = await Promise.all(
        drafts.map(async (d) => {
          const draftRes = await gmail.users.drafts.get({ userId: "me", id: d.id! });
          const h = draftRes.data.message?.payload?.headers ?? [];
          return {
            draftId: d.id,
            messageId: draftRes.data.message?.id,
            threadId: draftRes.data.message?.threadId,
            subject: extractHeader(h, "Subject"),
            to: extractHeader(h, "To"),
            snippet: draftRes.data.message?.snippet,
          };
        })
      );

      results.push({ account: email, drafts: detailed });
    } catch (err: any) {
      results.push({ account: email, error: err.message });
    }
  }

  return results;
}

function calendarErrorMessage(err: any, email: string): string {
  const status = err?.code ?? err?.response?.status;
  const reason =
    err?.errors?.[0]?.reason ?? err?.response?.data?.error?.errors?.[0]?.reason;
  const rawMessage = err?.message ?? String(err);

  if (
    status === 403 &&
    (reason === "insufficientPermissions" || /insufficient/i.test(rawMessage))
  ) {
    return `${email}'s token does not have calendar access yet (missing calendar.readonly scope). Run: npm run auth -- ${email}`;
  }
  if (status === 401) {
    return `${email}'s token is invalid or expired for calendar access. Run: npm run auth -- ${email} to re-authorize.`;
  }
  if (/invalid_grant/i.test(rawMessage)) {
    return `${email}'s token is invalid or expired for calendar access. Run: npm run auth -- ${email} to re-authorize.`;
  }
  return rawMessage;
}

function formatEvent(event: any) {
  const start = event.start?.dateTime ?? event.start?.date ?? "";
  const end = event.end?.dateTime ?? event.end?.date ?? "";
  const allDay = Boolean(event.start?.date) && !event.start?.dateTime;

  return {
    id: event.id,
    summary: event.summary ?? "(no title)",
    start,
    end,
    location: event.location ?? "",
    allDay,
    attendeeCount: (event.attendees ?? []).length,
  };
}

async function listEvents(params: {
  account?: string;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  calendarId?: string;
}) {
  const calendarId = params.calendarId ?? "primary";
  const timeMin = params.timeMin ?? new Date().toISOString();
  const timeMax = params.timeMax ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const maxResults = params.maxResults ?? 50;

  const tokenFiles = resolveTokenFiles(params.account);
  const results: any[] = [];

  for (const tokenFile of tokenFiles) {
    const email = accountFromPath(tokenFile);
    const calendar = google.calendar({ version: "v3", auth: getClient(tokenFile) });

    try {
      const res = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        maxResults,
        singleEvents: true,
        orderBy: "startTime",
      });
      results.push({
        account: email,
        events: (res.data.items ?? []).map(formatEvent),
      });
    } catch (err: any) {
      results.push({ account: email, error: calendarErrorMessage(err, email) });
    }
  }

  return results;
}

async function searchEvents(params: {
  query: string;
  account?: string;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
}) {
  const maxResults = params.maxResults ?? 50;
  const tokenFiles = resolveTokenFiles(params.account);
  const results: any[] = [];

  for (const tokenFile of tokenFiles) {
    const email = accountFromPath(tokenFile);
    const calendar = google.calendar({ version: "v3", auth: getClient(tokenFile) });

    try {
      const res = await calendar.events.list({
        calendarId: "primary",
        q: params.query,
        timeMin: params.timeMin,
        timeMax: params.timeMax,
        maxResults,
        singleEvents: true,
        orderBy: "startTime",
      });
      results.push({
        account: email,
        events: (res.data.items ?? []).map(formatEvent),
      });
    } catch (err: any) {
      results.push({ account: email, error: calendarErrorMessage(err, email) });
    }
  }

  return results;
}

async function getDraft(draftId: string, account?: string) {
  const tokenFiles = resolveTokenFiles(account);

  for (const tokenFile of tokenFiles) {
    const email = accountFromPath(tokenFile);
    const gmail = google.gmail({ version: "v1", auth: getClient(tokenFile) });

    try {
      const res = await gmail.users.drafts.get({ userId: "me", id: draftId });
      const h = res.data.message?.payload?.headers ?? [];
      return {
        draftId: res.data.id,
        messageId: res.data.message?.id,
        threadId: res.data.message?.threadId,
        subject: extractHeader(h, "Subject"),
        to: extractHeader(h, "To"),
        body: extractBody(res.data.message?.payload),
        account: email,
      };
    } catch {
      continue;
    }
  }

  throw new Error(`Draft ${draftId} not found in any connected account`);
}

const server = new Server(
  { name: "gmail-mcp", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_threads",
      description:
        "Search Gmail threads across one or all connected accounts using Gmail query syntax (same as the Gmail search box). Omit account or pass 'all' to search every connected account and merge results.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Gmail search query, e.g. 'invoice newer_than:7d -category:promotions'",
          },
          maxResults: {
            type: "number",
            description: "Max threads per account (default 50, max 100)",
            default: 50,
          },
          account: {
            type: "string",
            description: "Email address to search, or 'all' for all connected accounts. Omit for all.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_message",
      description: "Fetch the full body and headers of a Gmail message by ID.",
      inputSchema: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "Gmail message ID" },
          account: {
            type: "string",
            description: "Email address that owns this message. Omit to try all accounts.",
          },
        },
        required: ["messageId"],
      },
    },
    {
      name: "list_labels",
      description: "List Gmail labels for one or all connected accounts.",
      inputSchema: {
        type: "object",
        properties: {
          account: {
            type: "string",
            description: "Email address, or 'all' for all accounts. Omit for all.",
          },
        },
      },
    },
    {
      name: "list_accounts",
      description: "List all Gmail accounts that have an authorized token saved.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "create_draft",
      description: "Create a new Gmail draft in a specific account. Does not send it.",
      inputSchema: {
        type: "object",
        properties: {
          account: { type: "string", description: "Email address to create the draft in. Required." },
          to: { type: "string", description: "Recipient email address(es), comma-separated." },
          subject: { type: "string", description: "Subject line." },
          body: { type: "string", description: "Plain-text message body." },
          cc: { type: "string", description: "Cc email address(es), comma-separated." },
          bcc: { type: "string", description: "Bcc email address(es), comma-separated." },
          threadId: {
            type: "string",
            description: "Gmail thread ID to attach this draft to as a reply. Omit for a new thread.",
          },
        },
        required: ["account", "to", "subject", "body"],
      },
    },
    {
      name: "list_drafts",
      description: "List Gmail drafts for one or all connected accounts.",
      inputSchema: {
        type: "object",
        properties: {
          maxResults: {
            type: "number",
            description: "Max drafts per account (default 50, max 100)",
            default: 50,
          },
          account: {
            type: "string",
            description: "Email address, or 'all' for all accounts. Omit for all.",
          },
        },
      },
    },
    {
      name: "get_draft",
      description: "Fetch the full body and headers of a Gmail draft by ID.",
      inputSchema: {
        type: "object",
        properties: {
          draftId: { type: "string", description: "Gmail draft ID" },
          account: {
            type: "string",
            description: "Email address that owns this draft. Omit to try all accounts.",
          },
        },
        required: ["draftId"],
      },
    },
    {
      name: "list_events",
      description:
        "List calendar events across one or all connected accounts, ordered by start time. Expands recurring events into individual instances. Defaults to the next 7 days.",
      inputSchema: {
        type: "object",
        properties: {
          account: {
            type: "string",
            description: "Email address to list events for, or 'all' for all connected accounts. Omit for all.",
          },
          timeMin: {
            type: "string",
            description: "ISO 8601 start of the time range. Defaults to now.",
          },
          timeMax: {
            type: "string",
            description: "ISO 8601 end of the time range. Defaults to 7 days from now.",
          },
          maxResults: {
            type: "number",
            description: "Max events per account (default 50, max 100)",
            default: 50,
          },
          calendarId: {
            type: "string",
            description: "Calendar ID to query. Defaults to 'primary'.",
            default: "primary",
          },
        },
      },
    },
    {
      name: "search_events",
      description:
        "Search calendar events by text query across one or all connected accounts, ordered by start time. Expands recurring events into individual instances.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Free-text search query, matched against event summary, description, location, and attendees.",
          },
          account: {
            type: "string",
            description: "Email address to search, or 'all' for all connected accounts. Omit for all.",
          },
          timeMin: {
            type: "string",
            description: "ISO 8601 start of the time range. Omit for no lower bound.",
          },
          timeMax: {
            type: "string",
            description: "ISO 8601 end of the time range. Omit for no upper bound.",
          },
          maxResults: {
            type: "number",
            description: "Max events per account (default 50, max 100)",
            default: 50,
          },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    if (name === "search_threads") {
      result = await searchThreads(
        args!.query as string,
        (args!.maxResults as number) ?? 50,
        args!.account as string | undefined
      );
    } else if (name === "get_message") {
      result = await getMessage(
        args!.messageId as string,
        args!.account as string | undefined
      );
    } else if (name === "list_labels") {
      result = await listLabels(args!.account as string | undefined);
    } else if (name === "list_accounts") {
      result = { accounts: listAccounts() };
    } else if (name === "create_draft") {
      result = await createDraft(
        args!.account as string,
        args!.to as string,
        args!.subject as string,
        args!.body as string,
        args!.cc as string | undefined,
        args!.bcc as string | undefined,
        args!.threadId as string | undefined
      );
    } else if (name === "list_drafts") {
      result = await listDrafts(
        (args!.maxResults as number) ?? 50,
        args!.account as string | undefined
      );
    } else if (name === "get_draft") {
      result = await getDraft(
        args!.draftId as string,
        args!.account as string | undefined
      );
    } else if (name === "list_events") {
      result = await listEvents({
        account: args!.account as string | undefined,
        timeMin: args!.timeMin as string | undefined,
        timeMax: args!.timeMax as string | undefined,
        maxResults: args!.maxResults as number | undefined,
        calendarId: args!.calendarId as string | undefined,
      });
    } else if (name === "search_events") {
      result = await searchEvents({
        query: args!.query as string,
        account: args!.account as string | undefined,
        timeMin: args!.timeMin as string | undefined,
        timeMax: args!.timeMax as string | undefined,
        maxResults: args!.maxResults as number | undefined,
      });
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
