# GOTCHAS

One line each, added the moment something burns a session.

This file is an index, not an archive. It is read by every session at startup and is size-capped
(see `.githooks/pre-commit`), so anything needing more than a line or two lives in
`docs/gotchas/<slug>.md` with a pointer left here. Every gotcha is still listed, so nothing gets
rediscovered the hard way; you only pay for the detail when it is actually relevant.

- `~\repos\` one level up is itself an unrelated git repo (old, unrelated project history) that predates this repo's own `.git` (initialized 2026-06-16); running git commands from inside `gmail-mcp` before its own `.git` existed silently operated on that parent repo instead. Always confirm `git rev-parse --show-toplevel` resolves to this repo, not the parent, before running git commands here.
- `gmail.compose` bundles send permission with draft management at the Gmail API/token level; there is no Gmail OAuth scope that grants drafts-only access without also authorizing send. The token files in `tokens/` are more powerful than the tool surface (`create_draft`/`list_drafts`/`get_draft`) implies.
- To manually drive this server's stdio MCP protocol with an ad-hoc script (e.g. to verify tool registration), the script must live inside this repo (or run with `node <script>` from a directory Node's ESM resolver walks up from) so it can resolve `@modelcontextprotocol/sdk` from `node_modules/`; `NODE_PATH` does not help ESM bare-specifier resolution on Node 24. Delete the script and confirm `git status` is clean before committing.
