# gmail-mcp

A read-only, multi-account Gmail [MCP](https://modelcontextprotocol.io) server for Claude Code. Lets Claude search threads, read messages, and list labels across one or more Gmail accounts you've authorized, over stdio.

## Tools

| Tool | Description |
|---|---|
| `search_threads` | Search Gmail threads using standard Gmail query syntax (e.g. `invoice newer_than:7d -category:promotions`). Searches one account or all connected accounts and merges results. |
| `get_message` | Fetch the full body and headers of a message by ID. |
| `list_labels` | List Gmail labels for one or all connected accounts. |
| `list_accounts` | List all Gmail accounts that currently have an authorized token saved. |

All access is read-only (`gmail.readonly` scope) — this server cannot send, delete, or modify anything in Gmail.

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
