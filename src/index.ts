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

const server = new Server(
  { name: "gmail-mcp", version: "1.0.0" },
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
