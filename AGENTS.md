# Agent instructions

This file is the shared contract for every harness that reads `AGENTS.md` directly, rather than
`CLAUDE.md`. Claude Code reads it too, via `CLAUDE.md`'s `@AGENTS.md` import. Keep this file
authoritative and self-contained; don't assume the reader has also seen `CLAUDE.md`.

## What this is

A multi-account Gmail MCP server for Claude Code, over stdio. Exposes 7 tools: `search_threads`, `get_message`, `list_labels`, `list_accounts`, `create_draft`, `list_drafts`, `get_draft`, across whichever Gmail accounts have an authorized token in `tokens/`. Read access uses the `gmail.readonly` scope, draft creation uses `gmail.compose`; the server code never calls a send endpoint and cannot edit or delete existing drafts.

This is now load-bearing infrastructure, not a standalone tool: Hermes Agent's `config.yaml` (`~\AppData\Local\hermes\config.yaml`, under `mcp_servers.gmail`) launches this server directly (`node dist/index.js`) for Hermes's own email access, and my-EA's `finances` and `brainstorm` skills both depend on it for cross-account Gmail search. A broken build or a scope change here breaks those consumers too, not just this repo.

## Session start

Read `STATE.md` and `GOTCHAS.md` first, both short. Git and any live dashboards outrank any prose
claim about current state; check them before trusting a claim here. `DECISIONS.md` is the
append-only dated decision log: read it before reopening a settled call, add a line when you make
a new one, never rewrite an existing dated line.

Full protocol for what to read on entry, what to write on exit, and what to do when something
unexpected happens: `~\.agents\PROTOCOL.md`.

## Stack and run commands

TypeScript (ESM, `"type": "module"`), Node.js. `src/auth.ts` (one-off OAuth flow, authorizes an account and saves its token) and `src/index.ts` (the MCP server itself) compile to `dist/`. Dependencies: `@modelcontextprotocol/sdk`, `googleapis`.

Commands: `npm install`, `npm run build` (`tsc`), `npm start` (`node dist/index.js`), `npm run auth -- <email>` (authorizes one account, opens a Google consent screen, saves the token to `tokens/<email>.json`).

## Verification gate

`npm run build` (`tsc`) is the only real, codified `package.json` script that acts as a gate. No `test` or `lint` script exists; `auth` and `start` are runtime entry points, not verification steps. A change is done when `npm run build` compiles clean; there is no automated test suite to run beyond that.

This gate is non-negotiable for any harness or agent making code changes here, not just Claude
Code. A change that has not run the gate clean is not done. Do not commit with `--no-verify`. If a
cap or a gate step is genuinely wrong for the content, say so and get it changed rather than
routing around it.

## Repo boundaries

### Security: OAuth tokens for 4 real Gmail accounts

`tokens/*.json` holds real, live OAuth tokens for 4 real Gmail accounts (`account-1@example.com`, `account-2@example.com`, `account-3@example.com`, `account-4@example.com`). `credentials.json` at repo root holds the OAuth client credentials. Both are gitignored; neither has ever been tracked in this repo's git history, on any branch, confirmed by a full history search.

Never commit, print, cat, or otherwise output the contents of `tokens/*.json` or `credentials.json`. Never paste their content into a prompt, a file, a commit message, or any other channel a model reads. If you need to inspect whether a token file exists or what accounts are authorized, check the filename only (`ls tokens/`), never its content. Before any commit, confirm `.gitignore` still excludes both `tokens/` and `credentials.json`, and that `git status` shows neither as staged.

`gmail.compose` bundles send permission with draft management at the Gmail API/token level; there is no Gmail scope that grants drafts-only access without also authorizing send. Treat the token files in `tokens/` as more powerful than the tool surface (`create_draft`/`list_drafts`/`get_draft`) implies.

### Other boundaries

Depended on by Hermes Agent (`mcp_servers.gmail` in its `config.yaml`) and my-EA's `finances` and `brainstorm` skills. Changing tool names, tool signatures, or required scopes here can break those consumers; check for callers before renaming or removing a tool.

`~\repos\` one level up is itself an unrelated git repo (old, unrelated project history) that predates this repo's own `.git`. Always confirm `git rev-parse --show-toplevel` resolves to this repo before running git commands here.

Run `git status` before any checkout, commit, branch, or reset. If the tree carries changes you did not make, treat the repo as read-only and hand off rather than touch it, unless a session with visibility into that change has explicitly ruled it safe to proceed through.

## Writing style

No em dashes anywhere (user-facing copy, comments, docs). Natural, human phrasing; errors say what
happened and what to do next. Match the surrounding code's conventions.
