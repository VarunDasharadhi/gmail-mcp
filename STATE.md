# gmail-mcp STATE

Git and any live dashboards outrank this file; check them before trusting a claim here.

This file holds only what is true right now. History and session narrative live in
`docs/journal/`, settled calls live in `DECISIONS.md`, gotcha detail lives in `docs/gotchas/`. It
is size-capped by `.githooks/pre-commit` (see `PROTOCOL.md`); move content out rather than
deleting it. Never describe uncommitted work here, `git status` covers that live and accurately.

## What this is

TypeScript, multi-account Gmail + Calendar MCP server for Claude Code (stdio), 9 tools
(`search_threads`, `get_message`, `list_labels`, `list_accounts`, `create_draft`, `list_drafts`,
`get_draft`, `list_events`, `search_events`). `gmail.readonly` for Gmail reads, `gmail.compose`
for drafts, `calendar.readonly` for calendar reads; never sends mail and never creates, updates,
or deletes a calendar event. Depended on by Hermes Agent (`mcp_servers.gmail` in its
`config.yaml`) and my-EA's `finances` and `brainstorm` skills. Has its own GitHub remote, `main`
branch, public at `https://github.com/VarunDasharadhi/gmail-mcp`.

## Where the code stands

`main` is at `8c1d277` ("chore: add agent contract files"); this task's work is on
`feat/calendar-readonly`, cut from it, not merged. Read-only calendar support
(`list_events`/`search_events`) was added on top of the existing per-account OAuth2 client
pattern (`getClient`), reusing it for `google.calendar({version: "v3", auth})` rather than
duplicating the OAuth setup. `SCOPES` in `src/auth.ts` gained
`https://www.googleapis.com/auth/calendar.readonly`; the two Gmail scopes are unchanged.

**None of the 4 existing tokens (`tokens/*.json`) carry the new calendar scope yet.** Every
calendar call on every account will fail until Varun re-consents each one:
`npm run auth -- <email>` for each of the 4 accounts. Both calendar tools detect this
(403 insufficient-scope, or 401) and return a per-account error naming that exact command rather
than a bare 401; this was verified against all 4 live accounts on 2026-09-10 (see
`DECISIONS.md`).

Per the last real `HANDOFF.md` entry (2026-07-14, before an earlier task tombstoned that file):
draft creation (`create_draft`/`list_drafts`/`get_draft`) shipped, all 4 accounts were
re-authorized for the `gmail.compose` scope, and both commits were pushed to `origin/main`. Real
cross-provider mail merge (Yahoo/Outlook/iCloud) was discussed but never started; no CI or
automated tests exist.

Verification gate: `npm run build` (`tsc`) is the only real, codified script. No `test` or `lint`
script exists.

Security: `tokens/*.json` (4 real OAuth tokens) and `credentials.json` are gitignored and were
confirmed, via a full `git log --all` history search across both commits, to have never been
tracked on any branch. See AGENTS.md's Security section for the hard rules on these files.

A `package-lock.json` version-field drift (`1.0.0` in the last commit's lockfile vs `1.1.0` in
`package.json` and the working-tree lockfile, dated 2026-08-11) rode along in this task's commit
rather than being handled separately, per explicit coordinator sign-off that it is routine `npm
install` churn, not real uncommitted work.

Last verified: 2026-09-10
