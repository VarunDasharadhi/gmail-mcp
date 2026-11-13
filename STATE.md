# gmail-mcp STATE

Git and any live dashboards outrank this file; check them before trusting a claim here.

This file holds only what is true right now. History and session narrative live in
`docs/journal/`, settled calls live in `DECISIONS.md`, gotcha detail lives in `docs/gotchas/`. It
is size-capped by `.githooks/pre-commit` (see `PROTOCOL.md`); move content out rather than
deleting it. Never describe uncommitted work here, `git status` covers that live and accurately.

## What this is

TypeScript, multi-account Gmail + Calendar MCP server for Claude Code (stdio), 10 tools
(`search_threads`, `get_message`, `list_labels`, `list_accounts`, `create_draft`, `update_draft`,
`list_drafts`, `get_draft`, `list_events`, `search_events`). `gmail.readonly` for Gmail reads,
`gmail.compose` for drafts, `calendar.readonly` for calendar reads; the code never sends mail and never
deletes a draft (but a `gmail.compose` token technically can send, so tokens are credentials), and never creates, updates, or deletes a calendar event. Depended on by Hermes
Agent (`mcp_servers.gmail` in its `config.yaml`) and my-EA's `finances` and `brainstorm` skills.
Has its own GitHub remote, `main` branch, public at `https://github.com/VarunDasharadhi/gmail-mcp`.

## Where the code stands

`feat/calendar-readonly` now carries `main` (at `f91f292`, HTML drafts) merged in, on top of the
calendar work; merging the branch back into `main` waits for Varun. Read-only calendar support
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
(403 insufficient-scope, or 401) and return a per-account error naming that exact command rather
than a bare 401; this was verified against all 4 live accounts on 2026-09-10. No written evidence of
that run survives in this repo: `DECISIONS.md`'s 2026-09-10 entry records the decision, not the
verification output.
They also map a revoked or expired token (`invalid_grant`) to the same actionable message, but
that branch has only been verified against a synthetic throwaway harness with fabricated error
shapes, not against any live account or a real revoked token.

Per the last real `HANDOFF.md` entry (2026-07-14, before an earlier task tombstoned that file):
draft creation (`create_draft`/`list_drafts`/`get_draft`) shipped, all 4 accounts were
re-authorized for the `gmail.compose` scope, and the work was pushed to `origin/main`. Real
cross-provider mail merge (Yahoo/Outlook/iCloud) was discussed but never started; there is no CI.

Verification gate: `npm run build` (`tsc`), then `node --test dist/compose.test.js dist/security.test.js`
(`src/compose.ts` mail building, and the pure helpers in `src/security.ts`: argument checks,
account matching, OAuth state and grant checks, token file modes). No `test` or `lint` script exists
in package.json.

Security: `tokens/*.json` (4 real OAuth tokens) and `credentials.json` are gitignored and were
confirmed, via a full `git log --all` history search, to have never been tracked on any branch. See AGENTS.md's Security section for the hard rules on these files.

Auth flow on a headless server: `npm run auth` starts a callback that listens on 127.0.0.1 only, so the
consent URL must be opened in a browser on the same machine (for example the xrdp desktop). Or, from another computer, forward the port first with `ssh -L 9427:127.0.0.1:9427 <server>` and open the URL in a browser there.