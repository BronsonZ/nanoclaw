# NanoClaw Guide

NanoClaw is a personal multi-channel assistant. It runs as a single Node.js
process with self-registering channel skills and routes messages to agent
containers with isolated group workspaces and memory.

Root Claude guidance remains in `CLAUDE.md`; this file is the Codex-native
project guide. Read `CONTRIBUTING.md` before preparing PRs, skills, or
contribution-shaped changes.

## Key Files

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry and self-registration |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger patterns, paths, intervals |
| `src/container-runner.ts` | Agent container spawning and mounts |
| `src/task-scheduler.ts` | Scheduled task runner |
| `src/db.ts` | SQLite access |
| `container/skills/` | Skills loaded inside agent containers |
| `groups/*/CLAUDE.md` | Runtime group prompts; do not rewrite as Codex docs |

## Commands

Run commands directly when needed.

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm run test
./container/build.sh
```

Linux service management:

```bash
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Working Rules

- Credential handling is centralized in `src/credential-proxy.ts`. Containers
  should not receive raw secrets directly.
- Do not expose `.env` values, OAuth tokens, or Claude/OpenAI credentials in
  logs, docs, commits, or final summaries.
- Prefer clear, descriptive naming; avoid terse abbreviations when adding
  TypeScript APIs.
- When changing TypeScript behavior, validate with `npm run typecheck` and the
  narrowest relevant test or lint command.
- Container build cache can retain stale COPY layers. If a clean rebuild is
  necessary, prune the builder before rerunning `./container/build.sh`.
- If project layout, validation, runtime boundaries, or agent workflow guidance
  changes, update this file and keep detailed procedures in linked docs.

## Custom MCP Builds

Custom MCP server builds are staged through `/home/bzserver/repos/mcp/builds/`.
NanoClaw containers see that path read-only as `/workspace/mcp-servers/`.

Each deployed MCP server needs build output, `package.json`, and `node_modules/`.
After updating a build, clear cached agent-runner source under
`data/sessions/*/agent-runner-src`, rebuild NanoClaw, and restart the user
service when the change needs to be picked up.
