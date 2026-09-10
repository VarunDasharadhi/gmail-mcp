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

**None of the 4 existing tokens (`tokens/*.json`) carry the new calendar scope yet.** Before
re-consenting any account, confirm in the Google Cloud project behind `credentials.json` that the
Calendar API is enabled and that `calendar.readonly` is registered on the OAuth consent screen's
scope list; without both, `npm run auth -- <email>` will not actually grant working calendar
access (a missing API enablement surfaces as a 403 `accessNotConfigured` on every call; a missing
consent-screen scope can make consent fail or silently not grant the scope). Once that is
confirmed, every calendar call on every account will fail until Varun re-consents each one:
`npm run auth -- <email>` for each of the 4 accounts. Both calendar tools detect a missing scope
(403 insufficient-scope, or 401) and a revoked or expired token (`invalid_grant`) and return a
per-account error naming that exact command rather than a bare 401 or a raw `invalid_grant`; this
was verified against all 4 live accounts on 2026-09-10 (see `DECISIONS.md`).

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

Last verified: 2026-09-10
