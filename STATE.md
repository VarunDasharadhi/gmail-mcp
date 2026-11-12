# gmail-mcp STATE

Git and any live dashboards outrank this file; check them before trusting a claim here.

This file holds only what is true right now. History and session narrative live in
`docs/journal/`, settled calls live in `DECISIONS.md`, gotcha detail lives in `docs/gotchas/`. It
is size-capped by `.githooks/pre-commit` (see `PROTOCOL.md`); move content out rather than
deleting it. Never describe uncommitted work here, `git status` covers that live and accurately.

## What this is

TypeScript, multi-account Gmail MCP server for Claude Code (stdio), 8 tools (`search_threads`,
`get_message`, `list_labels`, `list_accounts`, `create_draft`, `update_draft`, `list_drafts`, `get_draft`).
`gmail.readonly` for reads, `gmail.compose` for drafts; never sends mail. Depended on by Hermes
Agent (`mcp_servers.gmail` in its `config.yaml`) and my-EA's `finances` and `brainstorm` skills.
Has its own GitHub remote, `main` branch, public at
`https://github.com/VarunDasharadhi/gmail-mcp`.

## Where the code stands

`main` was at `365304b` ("Add draft creation support") before this task's `chore/agent-contract`
branch was cut off it. Per the last real `HANDOFF.md` entry (2026-07-14, before this task
tombstoned that file): draft creation (`create_draft`/`list_drafts`/`get_draft`) shipped, all 4
accounts were re-authorized for the new `gmail.compose` scope, and both commits were pushed to
`origin/main`. Real cross-provider mail merge (Yahoo/Outlook/iCloud) was discussed but never
started; no CI or automated tests exist.

Verification gate: `npm run build` (`tsc`) is the only real, codified script. No `test` or `lint`
script exists.

Security: `tokens/*.json` (4 real OAuth tokens) and `credentials.json` are gitignored and were
confirmed, via a full `git log --all` history search across both commits, to have never been
tracked on any branch. See AGENTS.md's Security section for the hard rules on these files.

A `package-lock.json` version-field drift (`1.0.0` in the last commit's lockfile vs `1.1.0` in
`package.json` and the working-tree lockfile, dated 2026-08-11) rode along in this task's commit
rather than being handled separately, per explicit coordinator sign-off that it is routine `npm
install` churn, not real uncommitted work.

Last verified: 2026-09-09
