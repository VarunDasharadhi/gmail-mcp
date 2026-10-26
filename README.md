# gmail-mcp

A multi-account Gmail [MCP](https://modelcontextprotocol.io) server for Claude Code. Lets Claude search threads, read messages, list labels, and create drafts across one or more Gmail accounts you've authorized, over stdio.

## Tools

| Tool | Description |
|---|---|
| `search_threads` | Search Gmail threads using standard Gmail query syntax (e.g. `invoice newer_than:7d -category:promotions`). Searches one account or all connected accounts and merges results. |
| `get_message` | Fetch the full body and headers of a message by ID. |
| `list_labels` | List Gmail labels for one or all connected accounts. |
| `list_accounts` | List all Gmail accounts that currently have an authorized token saved. |
| `create_draft` | Create a new draft (to, subject, body, optional cc/bcc/threadId/from) in a specific account. Never sends it. |
| `list_drafts` | List drafts for one or all connected accounts. |
| `get_draft` | Fetch the full body and headers of a draft by ID. |
| `list_events` | List calendar events (default: next 7 days) across one or all connected accounts, expanding recurring events. Returns id, summary, start, end, location, all-day flag, and attendee count per event. |
| `search_events` | Search calendar events by free-text query across one or all connected accounts. Same output shape as `list_events`. |

Scopes: `gmail.readonly` for all Gmail read operations, `gmail.compose` for draft creation, and `calendar.readonly` for calendar reads. This server cannot edit or delete existing drafts, cannot send mail, and cannot create, update, or delete calendar events, it is read-only on the calendar side.

Accounts authorized before calendar support was added need to re-consent (see step 3 below) before `list_events` or `search_events` will work for them; until then, both tools return a clear per-account error naming the exact `npm run auth -- <email>` command to fix it, instead of a bare 401.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Get OAuth credentials

1. Create (or reuse) a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Gmail API**.
3. Create an **OAuth client ID** of type **Desktop app**.
4. Download the credentials and save them as `credentials.json` in the project root.

`credentials.json` and everything under `tokens/` are gitignored — never commit them.

### 3. Authorize one or more Gmail accounts

```bash
npm run build
npm run auth -- youraccount@gmail.com
```

This opens a Google consent screen in your browser and, on approval, saves the resulting token to `tokens/youraccount@gmail.com.json`. Repeat for each account you want Claude to have access to.

Before re-authorizing any account for calendar access, confirm two things in the Google Cloud project behind `credentials.json`: the **Calendar API is enabled**, and `calendar.readonly` is **registered as a scope on the OAuth consent screen**. Without both, running `npm run auth` will not actually grant working calendar access: a missing API enablement surfaces as a 403 `accessNotConfigured` on every call, and a missing consent-screen scope can make consent fail or silently not grant the scope.

If an account was authorized before draft support or calendar support was added, re-run `npm run auth -- <email>` for it: the old token won't have permission for the newer scope and API calls will fail with an insufficient-scope error (calendar tools report this as a clear, actionable message naming the re-auth command; older Gmail draft calls fail the same way).

### 4. Register the server with Claude Code

Point Claude Code at the built server, e.g. in your MCP config:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "node",
      "args": ["<path-to-repo>/dist/index.js"]
    }
  }
}
```

## Development

```bash
npm run build   # compile TypeScript to dist/
npm start        # run the compiled server
```

## Project structure

```
src/
  auth.ts    # one-off OAuth flow: authorizes an account and saves its token
  index.ts   # MCP server: exposes search_threads, get_message, list_labels, list_accounts,
             # create_draft, list_drafts, get_draft, list_events, search_events
```

Tokens are stored per account in `tokens/<email>.json` and are loaded on demand from `TOKENS_DIR` at request time, so accounts can be added or removed without restarting the server.
