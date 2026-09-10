# DECISIONS

Append-only, dated, one line per decision plus the why. Read before reopening a settled call.
Never rewrite or delete an existing dated line; if a decision is later reversed, append a new line
saying so rather than editing the old one.

[2026-09-10] DECISION: Add Calendar support to gmail-mcp as `calendar.readonly` only, no write scope, exposed as two read-only tools (`list_events`, `search_events`) built on the existing per-account `getClient` OAuth2 pattern. | REASONING: Hermes's 07:30 daily briefing needs calendar reads, not writes; this repo already holds OAuth tokens and a working per-account client pattern for all 4 accounts, so extending it is smaller than standing up a second MCP server, and a read-only scope keeps the blast radius of a compromised token to "can see the calendar" rather than "can also change it." | CONTEXT: Phase 2 Task 1, brief at `my-EA/.superpowers/sdd/phase2-hermes-as-ea/task-1-brief.md`. All 4 existing tokens predate this scope and need `npm run auth -- <email>` re-consent before the new tools return real data; until then both tools return a per-account error naming that exact command.
