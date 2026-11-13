# gmail-mcp

A multi-account Gmail [MCP](https://modelcontextprotocol.io) server for Claude Code. Lets Claude search threads, read messages, list labels, and create drafts across one or more Gmail accounts you've authorized, over stdio.

## Tools

| Tool | Description |
|---|---|
| `search_threads` | Search Gmail threads using standard Gmail query syntax (e.g. `invoice newer_than:7d -category:promotions`). Searches one account or all connected accounts and merges results. |
| `get_message` | Fetch the full body and headers of a message by ID. |
| `list_labels` | List Gmail labels for one or all connected accounts. |
| `list_accounts` | List all Gmail accounts that currently have an authorized token saved. |
| `create_draft` | Create a new draft (to, subject, body or html, optional from/signature/cc/bcc/threadId) in a specific account. Always HTML with an unwrapped plain-text copy, so Gmail never cuts lines; `from` must be a send-as address, and its saved Gmail signature is added. Never sends it. |
| `update_draft` | Replace an existing draft's content in place, same options as `create_draft`. Never sends it. |
| `list_drafts` | List drafts for one or all connected accounts. |
| `get_draft` | Fetch the full body and headers of a draft by ID. |
| `list_events` | List calendar events (default: next 7 days) across one or all connected accounts, expanding recurring events. Returns id, summary, start, end, location, all-day flag, and attendee count per event. |
| `search_events` | Search calendar events by free-text query across one or all connected accounts. Same output shape as `list_events`. |

Scopes: `gmail.readonly` for all Gmail read operations, `gmail.compose` for draft creation and replacement, and `calendar.readonly` for calendar reads. The server code never calls a send endpoint, never deletes drafts, and never creates, updates, or deletes calendar events. Note that a `gmail.compose` token can technically send mail, so treat every file in `tokens/` as a credential. This server is read-only on the calendar side, and creating or updating a draft is as far as it goes on the Gmail side.

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

`credentials.json` and everything under `tokens/` are gitignored; never commit them.

### 3. Authorize one or more Gmail accounts

```bash
npm run build
npm run auth -- youraccount@gmail.com
```

This prints a Google consent URL; open it in a browser and, on approval, the token is saved to `tokens/youraccount@gmail.com.json` (directory mode 0700, file mode 0600). The callback listens on 127.0.0.1 only, so on a headless server the browser must be on the same machine (for example the xrdp desktop). Or, from another computer, forward the port first with `ssh -L 9427:127.0.0.1:9427 <server>` and open the URL in a browser there. The token is refused unless the signed-in account matches the email you gave and exactly the three scopes (`gmail.readonly`, `gmail.compose`, `calendar.readonly`) were granted. Repeat for each account you want Claude to have access to.

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
node --test dist/compose.test.js dist/security.test.js   # tests, after a build
```

## Project structure

```
src/
  auth.ts      # one-off OAuth flow: authorizes an account and saves its token
  index.ts     # MCP server: exposes search_threads, get_message, list_labels, list_accounts,
               # create_draft, update_draft, list_drafts, get_draft, list_events, search_events
  compose.ts   # builds the draft mail (HTML, plain copy, headers, signature)
  security.ts  # pure checks: argument validation, account matching, OAuth state and grant, token files
```

Tokens are stored per account in `tokens/<email>.json` and are loaded on demand from `TOKENS_DIR` at request time, so accounts can be added or removed without restarting the server.
