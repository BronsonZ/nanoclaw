# Custom Branch Changes

Documentation of all customizations authored by Bronson on the `custom` branch relative to upstream `main`. Each section covers the motivation, technical implementation, and system-wide implications.

Changes from merged upstream feature branches (credential proxy, /compact, channel-aware text formatting, Telegram reply context/topic support/file downloads, Gmail skill) are excluded — those are upstream work that happens to be present on this branch.

---

## 1. Declarative Container Configuration System

**Commits:** `94402da`, `e09a6ab`, `18ec859`, `67c5a42`, `4e2c804`, `9908d93`
**Files:** `src/mount-security.ts`, `src/container-runner.ts`, `src/types.ts`, `src/config.ts`, `src/container-config.test.ts`

### Why

Upstream NanoClaw supports additional mounts via per-group database entries (`additionalMounts` in group config) and a security allowlist at `~/.config/nanoclaw/mount-allowlist.json`. This works for simple cases, but adding MCP servers, environment variables, or mount descriptions required hardcoded changes in `container-runner.ts` and `agent-runner/src/index.ts` — followed by a container rebuild.

Every new integration (Seerr, GitHub, Obsidian, docker-stacks) meant editing TypeScript and rebuilding. This doesn't scale and creates unnecessary upstream divergence.

### How It Works

A unified JSON file at `~/.config/nanoclaw/container-config.json` declares three sections:

**Mounts** — Additional host directories to mount into containers:
```json
{
  "mounts": [
    {
      "path": "~/docker-stacks",
      "containerPath": "/workspace/extra/docker-stacks",
      "readWrite": true,
      "scope": "allGroups",
      "description": "Docker Compose stacks for all server services",
      "contextFile": "docker-stacks.md"
    }
  ]
}
```

Each mount can reference a `contextFile` in `~/.config/nanoclaw/mount-context/`. These sidecar files are concatenated into a generated `/workspace/extra/.mounts/CLAUDE.md` inside the container, giving the agent documentation about what each mount contains and how to use it. Both host and container paths are included so the agent understands the real filesystem layout.

**MCP Servers** — Declarative MCP server definitions:
```json
{
  "mcpServers": {
    "seerr": {
      "command": "npx",
      "args": ["-y", "@jhomen368/overseerr-mcp@2.1.0"],
      "envFromDotenv": ["SEERR_URL", "SEERR_API_KEY"],
      "description": "Media request management",
      "contextFile": "seerr.md"
    }
  }
}
```

MCP servers support:
- `envFromDotenv`: Variable names resolved from `.env` and passed via stdin to the SDK (never as Docker `-e` flags — secrets stay off the command line)
- `mounts`: Per-server credential mounts (e.g., `~/.gmail-mcp/` for Gmail OAuth)
- `allowedTools` / `disallowedTools`: Tool-level access control (auto-prefixed with `mcp__{name}__`)
- `contextFile`: Sidecar documentation in `~/.config/nanoclaw/mcp-context/`

**Environment Variables** — Top-level `envFromDotenv` array for variables passed as Docker `-e` flags (e.g., `GITHUB_PERSONAL_ACCESS_TOKEN`, `PIHOLE_PASSWORD`). Two distinct env paths exist intentionally: per-server `envFromDotenv` flows through stdin to the SDK (for MCP server processes), while top-level `envFromDotenv` becomes Docker `-e` flags (for the container environment itself).

### System Implications

- **Additive design.** Config mounts stack on top of hardcoded mounts (project root, store, group folder, global, IPC) and DB-level `additionalMounts`. Hardcoded MCP servers (`nanoclaw` for IPC, `gmail` for OAuth autoauth) are always present; config servers are added alongside them. Nothing is replaced.
- **No rebuild needed.** Config is read fresh on each container invocation. Adding a new MCP server or mount is a JSON edit + service restart.
- **Non-main read-only enforcement.** Mounts marked `readWrite: true` are forced to read-only for non-main groups, regardless of config. Enforced in `mount-security.ts`.
- **644 lines of tests** in `src/container-config.test.ts` covering mount validation, allowlist loading, blocked pattern matching, symlink resolution, per-group scoping, and MCP config.

**Current config includes:** Seerr MCP (@2.1.0), GitHub MCP, Gmail overrides, Context7, Tavily, ObsidianVault mount, docker-stacks mount, websites mount, git credentials, Docker host/BuildKit env, Pi-hole password.

---

## 2. Docker CLI and Infrastructure Access

**Commits:** `55750be`, `92bd454`, `5f34986`, `e6bd7d8`, `b405d18`
**Files:** `container/Dockerfile`, `container/skills/deploy-service/SKILL.md`, `src/container-runner.ts`

### Why

The agent had no way to manage the server's Docker infrastructure — it couldn't start/stop services, read container logs, or deploy new stacks. For a personal server management assistant, this was the biggest capability gap. The agent could answer questions about Docker but couldn't actually do anything.

### How It Works

**Docker in the container:** The Dockerfile installs Docker CLI 27.5.1 and Docker Compose plugin v2.32.4 as static binaries (client-only, no daemon). Inside the container, `DOCKER_HOST=tcp://host.docker.internal:2375` points to the dedicated socket proxy at `~/nanoclaw/infra/socketproxy-nanoclaw/`.

**Socket proxy permissions** (configured in the infra stack, outside agent reach):
- **Allowed:** Container lifecycle (start, stop, restart, logs), image builds, network/volume/image inspection
- **Blocked:** `exec` (sandbox escape vector), `secrets`, `swarm`, `auth`
- **BuildKit disabled** (`DOCKER_BUILDKIT=0`) due to nginx proxy limitation with h2c upgrades

**GitHub access:** `GITHUB_PERSONAL_ACCESS_TOKEN` passed via top-level `envFromDotenv` so the agent can interact with repos and APIs.

**Deploy-service skill** (`container/skills/deploy-service/SKILL.md`): A comprehensive guide the agent loads at runtime covering:
- Docker Compose conventions (paths, restarts, environment, networks)
- Caddy reverse proxy configuration for both private (`*.bzserver.lan`, HTTP) and public (`*.bzserver.com`, HTTPS) services
- Sub-path routing patterns
- Pi-hole v6 REST API operations (auth, A records, CNAME records)
- Full deployment checklist

### System Implications

- **`~/docker-stacks/` mounted read-write** into main group containers via `container-config.json`.
- **`~/nanoclaw/infra/` is never mounted** — the agent cannot modify its own security boundary (socket proxy, dashboard).
- **Self-serve deployment loop:** The agent can write a compose file, start the stack, add a Caddy route, and create Pi-hole DNS records — all from a single chat message. This is the primary workflow the Docker access was designed to enable.
- **Container telemetry disabled** (`b405d18`) to avoid sending agent container activity to Anthropic.

---

## 3. Global CLAUDE.md System

**Commits:** `fbed3b3`, `cc2b7d8`, `eb6a25b`
**Files:** `container/agent-runner/src/index.ts`, `src/container-runner.ts`, `groups/global/CLAUDE.md`

### Why

Upstream NanoClaw gives each group its own `CLAUDE.md` for identity and memory. This meant duplicating personality, tone, capabilities, and rules across every group file. Any change to the agent's core identity required editing multiple files, and drift between groups was inevitable.

### How It Works

`groups/global/CLAUDE.md` is injected as a system prompt for **all groups** — the upstream `!isMain` guard was removed so non-main groups also receive the global identity. The content split:

- **Global CLAUDE.md:** Identity, personality, tone, communication style, core capabilities, universal rules, formatting conventions, memory hierarchy
- **Per-group CLAUDE.md:** Group-specific operational instructions, mount documentation, group memory

The `groups/global/` directory is mounted **read-write for the main group** and **read-only for all others** (enforced by `nonMainReadOnly` in the mount allowlist). This lets the main group evolve the agent's identity over time while non-main groups inherit it without modification risk.

**Model selection** was added alongside this change: `ANTHROPIC_MODEL` env var in `.env` takes precedence, with `settings.json` providing the default for new sessions. Supports aliases (`opus`, `sonnet`, `haiku`) and full model IDs.

### System Implications

- **Single source of truth** for agent identity. Personality changes propagate to all groups immediately.
- **Per-group CLAUDE.md slimmed** significantly (~157 lines of duplicated global content removed from main group).
- **Global is configuration, not memory.** The agent should not store conversation memories or group-specific context in the global file.

---

## 4. Telegram Typing Indicator Fix

**Commits:** `d4df03e`, `d872bcb`
**Files:** `src/channels/telegram.ts`, `src/index.ts`

### Why

Telegram's `sendChatAction('typing')` auto-expires after approximately 5 seconds. NanoClaw agent responses routinely take 30+ seconds. After the first 5 seconds, the typing indicator disappeared and users had no feedback that the agent was still processing. This was especially confusing for longer tasks.

A second issue: when the agent's entire output consisted of `<internal>` tags (internal processing with no user-visible content), `sendMessage()` was never called. Since `sendMessage()` was the only thing that cleared the typing indicator, the indicator persisted until the container idle timeout (~30 minutes).

### How It Works

**Typing refresh (`d4df03e`):** `TelegramChannel` maintains a `typingIntervals` Map keyed by JID. `setTyping(true)` sends the action immediately, then starts a 4-second `setInterval` to re-send before the 5-second expiry. Three cleanup paths:
1. `sendMessage()` clears the interval (normal completion)
2. `setTyping(false)` clears the interval (explicit stop)
3. `disconnect()` clears all intervals (shutdown)

**Internal output fix (`d872bcb`):** After agent processing completes, if no user-visible output was produced (all content wrapped in `<internal>` tags), an explicit `setTyping(false)` call clears the indicator in `src/index.ts`.

### System Implications

- **Channel-specific implementation.** The 4-second refresh interval is specific to Telegram's 5-second expiry. Other channels with different typing semantics are unaffected.
- **Two-layer cleanup** ensures typing is always eventually cleared regardless of output content or error conditions.

---

## 5. Plan Mode Block

**Commits:** `4f96f0c`
**Files:** `container/agent-runner/src/index.ts`, `src/container-runner.ts`

### Why

The agent got stuck (2026-04-09) when it entered Claude Code's plan mode inside a headless container. Plan mode requires interactive terminal confirmation to exit — the user must approve the plan before the agent can proceed. In SDK containers (no TTY, no interactive input), the agent called `ExitPlanMode` repeatedly with no way to confirm, idling until timeout.

### How It Works

Two defenses:
1. `EnterPlanMode` and `ExitPlanMode` added to the `disallowedTools` array — the agent simply cannot enter plan mode.
2. `setPermissionMode('bypassPermissions')` forced at the start of **every query**, not just the first. This prevents sessions that somehow entered a restricted permission state from staying stuck across queries.

### System Implications

- **No functional loss.** The agent can still reason about plans in response text — it just can't enter the formal plan mode state that requires terminal interaction.
- **Observability improved.** Tool use logging promoted to `info` level in the same commit, making it easier to debug what the agent is doing inside the container.

---

## 6. Gmail Channel Customizations

**Commits:** `02671a1`, `2e5e569`, `c0cb4a2`
**Files:** `src/channels/gmail.ts` (modifications to upstream skill), `container/agent-runner/src/index.ts`

### Why

The upstream Gmail skill (by gavrielc) provides email channel integration. Bronson's customizations restrict it to read-only operation and add email-digest references.

### How It Works

- **Read-only access (`02671a1`, `2e5e569`):** Gmail is configured as a tool the agent can use to read emails, but `mcp__gmail__send_email` is added to `disallowedTools` in the agent runner. The agent can search, read threads, and list messages, but cannot send emails. This prevents accidental or unwanted outbound email.
- **Email-digest references (`c0cb4a2`):** CLAUDE.md files updated with references to the email-digest container skill for composing digest-style summaries of email activity.

### System Implications

- **Safety boundary.** Blocking email send is a deliberate restriction — email is a high-visibility external action that's hard to undo. The agent can draft responses but a human must send them.
- **Gmail OAuth must be in GCP Production mode** (not Testing) — Testing mode tokens expire after 7 days. Graceful degradation (from upstream) skips the Gmail channel on expired tokens instead of crashing.

---

## 7. Task Script Timeout Increase

**Commits:** `0f15193`
**Files:** `container/agent-runner/src/index.ts`

### Why

Scheduled tasks can run a bash script to check conditions before waking the agent (e.g., check if a service is down before starting a full agent session). The upstream 30-second timeout was too short for scripts performing network calls, Docker operations, or other I/O-heavy checks.

### How It Works

`SCRIPT_TIMEOUT_MS` changed from `30_000` to `90_000`. A single constant change. Per-task configurable timeout was designed but deferred (would require ALTER TABLE migration to add a `timeout` column).

### System Implications

- The 90-second global default covers all current use cases.
- Upstream still uses 30 seconds.

> **Note:** Two related IPC fixes (`694e134` task snapshot refresh, `1d0b8e8` taskMutated removal) were also committed but have since been independently absorbed by upstream (`5ca0633` by Michael Bravo). They no longer produce a meaningful diff against `main`.

---

## 8. Seerr MCP Integration (Superseded)

**Commits:** `60ac823` (original), superseded by `e09a6ab` (declarative config)

> **This change was superseded by Section 1 (Declarative Container Config).** The Seerr MCP server was initially hardcoded in `agent-runner/src/index.ts`. That code was removed when the declarative MCP config system was built — Seerr now lives entirely in `container-config.json` as `@jhomen368/overseerr-mcp@2.1.0` with `envFromDotenv: ["SEERR_URL", "SEERR_API_KEY"]`. The integration still works; only the implementation mechanism changed. No hardcoded Seerr code remains in the diff.

---

## 9. Container Skills

**Commits:** `5f34986`, `d5f984f`, `c0cb4a2`, `b405d18`, `e6bd7d8`
**Files:** `container/skills/deploy-service/SKILL.md`, `container/skills/weather/SKILL.md`, `container/skills/email-digest/SKILL.md`

### Why

Container skills give the agent domain-specific knowledge loaded at runtime. They're SKILL.md files (YAML frontmatter + markdown) discovered via `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`. No code changes or rebuilds needed to add new ones.

### Skills Added

| Skill | Purpose |
|-------|---------|
| `deploy-service` | Deploying Docker services with Caddy reverse proxy + Pi-hole DNS. Covers compose conventions, private/public routing, sub-path patterns, DNS API operations, deployment checklist. |
| `weather` | Weather data retrieval. |
| `email-digest` | Email-based task digest composition. |

### System Implications

- **Copied fresh** on each container invocation from `container/skills/`. Changes take effect on next agent run.
- **deploy-service is the most substantial** — it encodes the full server infrastructure conventions so the agent can deploy services that follow the established patterns (correct networks, restart policies, DNS naming, Caddy configuration).

---

## 10. Interactive Configuration Skills

**Commits:** `4689ef1`
**Files:** `.claude/skills/add-mcp-server/SKILL.md`, `.claude/skills/add-volume-mount/SKILL.md`

### Why

Adding new MCP servers or volume mounts to `container-config.json` requires understanding the config schema, allowlist rules, and naming conventions. Interactive skills guide the process.

### How It Works

These are Claude Code skills (not container skills) that run in the host Claude Code session:
- **add-mcp-server:** Discovers available MCP servers, walks through configuration (command, args, env vars, mounts, tool restrictions), generates the JSON block, and updates `container-config.json`.
- **add-volume-mount:** Validates host paths, checks against the mount allowlist and blocked patterns, generates the mount config block with optional context file.

### System Implications

- **Config-only, no code changes.** Both skills modify `~/.config/nanoclaw/container-config.json` and associated context files. No rebuild or container changes needed.

---

## 11. Housekeeping

### Lint-Staged Pre-Commit (`6076e0c`)
Added `lint-staged` with Prettier for consistent code formatting on commit. Prevents style drift.

### npm Audit Fix (`721fcb5`)
Security audit fix for transitive dependencies.

### Merge Artifact Cleanup (`7a70010`)
Removed duplicate `grammy` dependency entry that appeared from merge conflicts.

### Gitignore Local CLAUDE.md (`ddef8d8`)
Local CLAUDE.md files (used for per-machine overrides) excluded from git tracking.

### Formatting Instructions Slimmed (`eb6a25b`)
After upstream's `skill/channel-formatting` branch was merged, redundant formatting instructions were removed from CLAUDE.md files.

### Restart Skill Rename (`2f9a938`, `0d4fa4f`)
Added a restart skill, then renamed it from `restart` to `restart-nanoclaw` for clarity.

### Prettier Formatting (`89a2d3d`, `1ab2da5`, `c9f0a6a`)
Code style cleanup across `src/mount-security.ts`, `src/channels/telegram.ts`, `src/index.ts`, and `src/session-commands.ts`. No functional changes.

---

## 12. `/clear` Session Command

**Commits:** `2886037`
**Files:** `src/session-commands.ts`, `src/session-commands.test.ts`, `src/index.ts`

### Why

Upstream ships `/compact` (from the `add-compact` skill), which explicitly leaves `/clear` unbuilt as a destructive counterpart. Before this, resetting conversation context required restarting the service or editing the SQLite `sessions` table by hand.

### How It Works

`/clear` is handled **entirely host-side** — it never reaches the container. `extractSessionCommand` recognizes it alongside `/compact`; `handleSessionCommand` branches to call a new `clearSession` dep, send `"Conversation cleared."`, and advance the cursor. No pre-command processing, no `runAgent` call.

`clearSession` reuses the two-line idiom already at `src/index.ts:449-450` (from SDK stale-session recovery):

```ts
delete sessions[group.folder];
deleteSession(group.folder);
```

The next message then calls `query()` with `resume: undefined` → SDK starts a fresh conversation, and the new session_id is persisted via the existing `wrappedOnOutput` path.

**Why not forward to the SDK like `/compact`?** Per the [SDK slash-commands docs](https://code.claude.com/docs/en/agent-sdk/slash-commands.md), `/clear` is not dispatchable through the SDK — forwarding it would be treated as plain text. The recommended pattern is exactly what host-side deletion achieves: end the current session, start a new one.

**Trust model** identical to `/compact`: main group or `is_from_me`. Reuses `isSessionCommandAllowed`.

**No archival.** The old transcript JSONL stays on disk and is resumable via the SDK's `resume` option. For a readable archive, run `/compact` first, then `/clear`.

### System Implications

- **Scheduled tasks unaffected.** `scheduled_tasks` / `task_run_log` have no FK to `sessions`. After `/clear`, the next speaker (human or `context_mode: 'group'` task) establishes the new session_id.
- **Survives service restart.** Both the in-memory eviction and the DB delete are required — `getAllSessions()` at `src/index.ts:97` would otherwise reload the stale session_id on restart and silently undo the clear.
- **Pre-`/clear` messages in the same polling batch are dropped** (vs `/compact`, which processes them first). Running them against a session we're about to wipe would be wasted work.

---

## Change Summary

| Area | Commits | Status | Key Benefit |
|------|---------|--------|-------------|
| Declarative Config | 6 | Active | Runtime-configurable mounts, MCP servers, env vars — no rebuilds |
| Docker Access | 5 | Active | Agent manages server infrastructure end-to-end |
| Global CLAUDE.md | 3 | Active | Single identity source, per-group specialization |
| Telegram Typing | 2 | Active | Reliable typing indicator during 30+ second processing |
| Plan Mode Block | 1 | Active | Prevents headless stuck state in SDK containers |
| Gmail Restrictions | 3 | Active | Read-only email access, no accidental sends |
| Task Script Timeout | 1 | Active | 30s → 90s for longer script execution |
| Container Skills | 5 | Active | Domain knowledge (deploy, weather, email) without code |
| Config Skills | 1 | Active | Guided MCP/mount setup |
| Housekeeping | 8 | Active | Formatting, dependencies, gitignore |
| `/clear` Command | 1 | Active | Host-side conversation reset without restart |
| Seerr MCP (hardcoded) | 1 | Superseded | Replaced by declarative config (Section 1) |
| Task snapshot refresh | 1 | Superseded | Absorbed by upstream (`5ca0633`) |
| taskMutated removal | 1 | Superseded | Absorbed by upstream |

**Total: 37 commits by BronsonZ** (29 co-authored with Claude, 8 solo).
**Active: 34 commits** — 3 were superseded (1 by own later work, 2 absorbed by upstream).

All active changes follow the principle of **extending upstream defaults rather than replacing them**. The declarative config system, additive mount/MCP stacking, and preserved hardcoded servers minimize upstream divergence and keep merges clean.
