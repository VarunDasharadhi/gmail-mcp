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

Scopes: `gmail.readonly` for all read operations, plus `gmail.compose` for draft creation. This server can replace a draft's content (`update_draft`) but never deletes drafts, and it cannot send mail. Creating or updating a draft is as far as it goes.

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

If an account was authorized before draft support was added (scopes changed from `gmail.readonly` only to `gmail.readonly` + `gmail.compose`), re-run `npm run auth -- <email>` for it — the old token won't have permission to create drafts and Gmail API calls will fail with an insufficient-scope error.

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
  index.ts   # MCP server: exposes search_threads, get_message, list_labels, list_accounts
```

Tokens are stored per account in `tokens/<email>.json` and are loaded on demand from `TOKENS_DIR` at request time, so accounts can be added or removed without restarting the server.
