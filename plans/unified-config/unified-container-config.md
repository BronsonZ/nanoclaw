# Unified Container Configuration

Session that wrote this file:
claude --resume 9e7a05bc-f5c7-4dd0-9b00-159bbf9665c5

## Context

Adding a new integration to NanoClaw (MCP server, mount, env var) currently requires editing source code in 2-3 files and rebuilding. This design unifies all three into a single declarative JSON config file.

**Current pain points:**

- ~~Mounts require two steps: allowlist JSON + SQL edit to DB `container_config`~~ **RESOLVED** — see [mount-config-implementation.md](mount-config-implementation.md)
- MCP servers are hardcoded in `container/agent-runner/src/index.ts` (lines 436-465) — currently 4 servers: nanoclaw, gmail, seerr, github
- Env vars are hardcoded per-integration in `src/container-runner.ts` (lines 254-279) — Seerr and GitHub env vars read from `.env` and forwarded via Docker `-e` flags
- Adding an integration (e.g., when GitHub MCP was added) requires code changes + rebuild in both files

**Goal:** Edit one JSON file to add/remove mounts, MCP servers, and env vars. No code changes, no rebuilds.

---

## Recommended Config Format

**Location:** `~/.config/nanoclaw/container-config.json` (replaces `mount-allowlist.json`)

```json
{
  "version": 1,
  "mounts": [
    {
      "path": "~/ObsidianVault",
      "containerPath": "obsidian",
      "readWrite": true,
      "allGroups": false,
      "description": "Obsidian vault for note editing",
      "contextFile": "obsidian.md"
    }
  ],
  "envFromDotenv": ["GITHUB_TOKEN", "GIT_USER_NAME", "GIT_USER_EMAIL"],
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["-y", "@gongrzhe/server-gmail-autoauth-mcp"],
      "description": "Gmail read access — search, read messages and threads",
      "contextFile": "gmail.md",
      "mounts": [
        {
          "hostPath": "~/.gmail-mcp",
          "containerPath": "/home/node/.gmail-mcp",
          "readWrite": true
        }
      ],
      "disallowedTools": [
        "send_email",
        "modify_email",
        "delete_email",
        "batch_modify_emails",
        "batch_delete_emails",
        "create_label",
        "update_label",
        "delete_label",
        "get_or_create_label",
        "create_filter",
        "delete_filter",
        "create_filter_from_template"
      ]
    },
    "seerr": {
      "command": "npx",
      "args": ["-y", "@jhomen368/overseerr-mcp"],
      "description": "Overseerr/Jellyseerr media request system",
      "contextFile": "seerr.md",
      "envFromDotenv": ["SEERR_URL", "SEERR_API_KEY"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "description": "GitHub API — repos, issues, PRs, code search",
      "contextFile": "github.md",
      "envFromDotenv": ["GITHUB_PERSONAL_ACCESS_TOKEN"]
    }
  },
  "security": {
    "extraBlockedPatterns": [],
    "nonMainReadOnly": true
  }
}
```

> **Note:** `envFromDotenv` keys must match the names the MCP server SDK expects. For GitHub, the SDK expects `GITHUB_PERSONAL_ACCESS_TOKEN`, so `.env` should use that name directly (not `GITHUB_TOKEN`). This avoids rename mapping complexity.

---

## Key Design Decisions

### 1. Config Location — `~/.config/nanoclaw/container-config.json`

Replaces `mount-allowlist.json` entirely. Outside project root = tamper-proof from containers. Follows the existing XDG pattern. Includes a `"version": 1` field for future schema evolution.

**Alternatives considered:**

- Keep `mount-allowlist.json` separate: adds unnecessary complexity for a single-user setup
- Put config in project root: would be visible inside containers, merge conflicts on upstream pulls

### 2. Mount Simplification — Presence = Allowed + Mounted ✅

If a mount is in the config, it's both allowed and mounted. No separate allowlist/request steps. Config mounts are **additive** — they stack on top of existing DB + allowlist mounts (both paths always run). Hardcoded security defaults (blocked patterns like `.ssh`, `.gnupg` in mount-security.ts) always apply.

The config's `security.extraBlockedPatterns` field **extends** the hardcoded defaults — it cannot remove them. This ensures native NanoClaw protections are never accidentally disabled.

Mounts default to main group only (`allGroups: false`). Set `allGroups: true` per mount to include non-main groups (subject to `nonMainReadOnly`).

For non-main groups: DB `containerConfig.additionalMounts` still works unchanged via the existing allowlist validation path.

### 3. MCP Server Format — Extended Claude Desktop Convention

Follows the standard `{ command, args, env }` format from Claude Desktop, with NanoClaw extensions:

| Field             | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `command`, `args` | Standard MCP server launch (same as Claude Desktop)             |
| `env`             | Static env var literals (non-secret config values)              |
| `envFromDotenv`   | List of `.env` keys to read at runtime (secrets stay in `.env`) |
| `mounts`          | Per-server credential/data mounts (e.g., Gmail OAuth dir)       |
| `disallowedTools` | Bare tool names auto-prefixed with `mcp__{server}__`            |
| `allowedTools`    | Optional override; default: `mcp__{server}__*` wildcard         |
| `description`     | Short description of what the server provides (injected into generated CLAUDE.md) |
| `contextFile`     | Optional filename in `~/.config/nanoclaw/mcp-context/` — rich usage context injected alongside description |

**Why `envFromDotenv` instead of inline values:** Secrets stay in `.env` (gitignored). Config file contains no secrets, safe to inspect/share.

**Why per-server `mounts`:** Keeps integration config self-contained. Adding/removing a server is one block. Gmail needs `~/.gmail-mcp` mounted writable for OAuth refresh — this is specific to the gmail MCP server, not a general mount.

### 4. Config Delivery to Agent-Runner — Extend ContainerInput via Stdin

**Recommended:** Add an `mcpServers` field to the `ContainerInput` interface (sent via stdin JSON). Container-runner resolves all env vars and builds the complete `mcpServers` object (including the always-present `nanoclaw` server with its dynamic per-group env vars). Agent-runner receives it ready to pass directly to the SDK `query()` call.

Also add `extraAllowedTools` and `extraDisallowedTools` fields to ContainerInput. These are additive — base SDK tools (`Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, etc.) and the `mcp__nanoclaw__*` wildcard stay hardcoded in agent-runner. Only MCP tool patterns from config flow through these fields.

**Why stdin over alternatives:**

- **vs. Generated file** (write `mcp-config.json` to agent-runner-src): Extra file I/O, stale file risk, mixes generated config with source code
- **vs. Env var** (`NANOCLAW_MCP_CONFIG`): JSON quoting fragility, harder to debug, size constraints
- **vs. Mounting config file**: Leaks host paths and security settings into container, extra mount
- **Stdin is already the protocol**: ContainerInput is already sent this way. Adding fields is zero-cost. Agent-runner already deserializes it. Always fresh per-invocation.

### 5. Tool Allowlisting — Auto-generate with Optional Override

Each declared MCP server auto-adds `mcp__{name}__*` to allowedTools. Per-server `disallowedTools` use bare names (auto-prefixed). Optional `allowedTools` field overrides the wildcard for granular control.

### 6. MCP Tool Context Files — Dynamic Agent Documentation

Same pattern as mount context files (Phase 2.5). Each MCP server can have a `description` (short, inline) and a `contextFile` (rich markdown) that are injected into a generated `CLAUDE.md` at container spawn time. The agent never sees the raw context files — only the assembled output.

**Host:** `~/.config/nanoclaw/mcp-context/{filename}.md` — outside project root, tamper-proof.

**Container:** Generated `CLAUDE.md` mounted read-only at `/workspace/extra/.mcp/`. Discovered by agent-runner's `/workspace/extra/*` scan → `additionalDirectories` → SDK auto-loads CLAUDE.md. Same mechanism as `/workspace/extra/.mounts/`.

**Generated output example:**

```markdown
# Available MCP Tool Servers

## gmail

Gmail read access — search, read messages and threads

[full content of ~/.config/nanoclaw/mcp-context/gmail.md]

## seerr

Overseerr/Jellyseerr media request system

[content of seerr.md]

## github

GitHub API — repos, issues, PRs, code search

[content of github.md]
```

Servers without a `contextFile` get the heading + description only. Servers without a `description` get the heading only. This is the same approach as mount descriptions — no regression for servers that don't opt in.

**Key outcome:** MCP tool documentation is fully config-driven. Group CLAUDE.md files never contain tool-specific content. Edit a context file, restart, and every group gets updated tool guidance.

### 7. Env Var Sourcing — Two Separate Paths

**Verified:** The MCP SDK (`@modelcontextprotocol/sdk`) does NOT inherit `process.env` when spawning MCP server processes. It merges a minimal default environment (`HOME`, `PATH`, `SHELL`, `TERM`, `USER`, `LOGNAME`) with the per-server `env` field (see `node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js` — `StdioClientTransport.start()`). This means per-server env vars must be explicitly included in the `env` field passed to the SDK — Docker `-e` flags alone are NOT sufficient.

This gives us a clean separation between two independent env var paths:

**Path 1: Per-server `envFromDotenv` / `env` → Stdin only (MCP server process)**

- `envFromDotenv: ["KEY"]` → read from `.env` at runtime via `readEnvFile()`
- `env: { "KEY": "value" }` → static literal, passed as-is
- Container-runner resolves these on the host, includes the resolved values in the `mcpServers.{name}.env` object sent via stdin
- Agent-runner passes the `mcpServers` object directly to the SDK `query()` call
- SDK injects them into the MCP server child process via `{ ...getDefaultEnvironment(), ...serverConfig.env }`
- These vars NEVER go through Docker `-e` flags — they don't need to be in the container's `process.env`

**Path 2: Top-level `envFromDotenv` → Docker `-e` only (container process)**

- Container-level env vars that agent-runner code reads from `process.env` directly
- Example: `GITHUB_TOKEN`, `GIT_USER_NAME`, `GIT_USER_EMAIL` (used by `setupGitConfig()` in agent-runner), `ANTHROPIC_MODEL`
- Container-runner reads from `.env` via `readEnvFile()`, forwards via Docker `-e` flags
- These vars NEVER go into the stdin `mcpServers` object — they're not MCP-specific

**Important:** `envFromDotenv` keys must match the names expected by the target MCP server SDK. No rename mapping — if an SDK expects `GITHUB_PERSONAL_ACCESS_TOKEN`, use that name in `.env` directly.

**`GITHUB_TOKEN` dual purpose:** `GITHUB_TOKEN` currently serves two roles: (1) GitHub MCP server auth (as `GITHUB_PERSONAL_ACCESS_TOKEN`) and (2) git HTTPS auth via `setupGitConfig()` in agent-runner. After migration: `GITHUB_PERSONAL_ACCESS_TOKEN` goes per-server (stdin path), `GITHUB_TOKEN` goes top-level (Docker `-e` path for git auth).

**Boundary with OneCLI:** OneCLI handles Anthropic API key injection via its credential proxy (HTTP-level, transparent to the container). `envFromDotenv` handles MCP-server-specific secrets and container-level env vars. These are complementary, not overlapping.

**Resolution summary:**

| Var type | Resolved where | Delivered how | Visible to |
|----------|---------------|---------------|------------|
| Per-server `envFromDotenv`/`env` | Host (`readEnvFile`) | Stdin → SDK `env` field | MCP server process only |
| Top-level `envFromDotenv` | Host (`readEnvFile`) | Docker `-e` flags | Container `process.env` (agent-runner + children) |
| System vars (TZ, OneCLI) | Host | Docker `-e` flags | Container `process.env` |

### 8. Migration — No Auto-Migration, Purely Additive

All changes are additive. Both old and new paths run independently.

1. Config mounts stack on top of DB + allowlist mounts (both always run)
2. Agent-runner: if `ContainerInput` has `mcpServers` → use it; else → fall back to hardcoded
3. No auto-migration — config file created manually when ready
4. Rename `GITHUB_TOKEN` to `GITHUB_PERSONAL_ACCESS_TOKEN` in `.env` (when MCP phase is implemented)
5. Old files (`mount-allowlist.json`, DB `additionalMounts`) never modified or removed

### 9. Error Handling

- **Invalid JSON**: Fail hard with a clear error message. Do not start the container — a broken config should not silently fall back to defaults.
- **Missing `.env` key** referenced by `envFromDotenv`: Log a warning, pass empty string. The MCP server may still start (some handle missing credentials gracefully).
- **Individual MCP server failure** (bad command, mount path doesn't exist): Warn and skip that server. Other servers and the container should still work. One broken integration shouldn't block everything.
- **Invalid mount path** (doesn't exist on host): Warn and skip. Log the specific path for easy debugging.

### 10. Config Reload Strategy

No persistent cache. `loadContainerConfig()` reads the file fresh on each container invocation. This is sufficient because:

- Config is only read when spawning a container (not on every message)
- File reads are cheap compared to container startup
- Avoids cache invalidation complexity
- Changes take effect on the next container spawn — no restart needed for config-only changes (service restart still needed for code changes)

### 11. Scope — Per-Group MCP Overrides

Per-group MCP server configuration is **out of scope for v1**. The config is global — all groups get the same MCP servers. This is sufficient for a single-user setup where only the main group is actively used. Future extension point: a per-group `mcpServers` override in DB `containerConfig` could allow groups to opt out of specific servers.

---

## What Stays Hardcoded

| Item                                                         | Why                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `nanoclaw` MCP server                                        | Custom IPC server with dynamic per-group env vars. Always required.       |
| Core mounts (project, group, .claude, IPC, agent-runner-src) | Structural to NanoClaw operation                                          |
| System env vars (TZ, ANTHROPIC_BASE_URL, auth)               | Always needed, not integration-specific                                   |
| Git env vars (GITHUB_TOKEN, GIT_USER_NAME, GIT_USER_EMAIL)   | Container-level for `setupGitConfig()`. Forwarded via top-level `envFromDotenv`, not per-server. |
| Base allowed tools (Bash, Read, Write, etc.)                 | Core SDK tools, always present in agent-runner                            |
| Default blocked mount patterns (.ssh, .gnupg, .aws, etc.)    | Hardcoded in mount-security.ts. Config can extend but never remove these. |

## What Moves to Config

| Item                           | Previously In                                                      | Config Field                               | Status |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------ | ------ |
| Gmail MCP server + OAuth mount | agent-runner `mcpServers` + container-runner `buildVolumeMounts()` | `mcpServers.gmail` (with `mounts`)         | ✅ Config (hardcoded gmail also kept for upstream compat) |
| Seerr MCP server + env vars    | agent-runner `mcpServers` + container-runner `-e` flags            | `mcpServers.seerr` (with `envFromDotenv`)  | ✅ Config only (hardcoded removed) |
| GitHub MCP server + env vars   | agent-runner `mcpServers` + container-runner `-e` flags            | `mcpServers.github` (with `envFromDotenv`) | ✅ Config only (hardcoded removed) |
| Gmail disallowedTools          | agent-runner `disallowedTools` array                               | `mcpServers.gmail.disallowedTools`         | ✅ Config (hardcoded also kept) |
| Git credentials                | container-runner hardcoded `-e` flags                              | Top-level `envFromDotenv`                  | ✅ Config |
| ObsidianVault mount            | mount-allowlist.json + DB `containerConfig`                        | `mounts` array                             | ✅ Config |
| Non-main readonly policy       | mount-allowlist.json `nonMainReadOnly`                             | `security.nonMainReadOnly`                 | ✅ Config |

---

## Files to Modify

| File                                  | Changes                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/types.ts`                        | ✅ `ContainerConfigFile`, `ConfigMount` (incl. `contextFile`), `McpServerConfig`, `McpServerMount` added. `ContainerConfigFile` extended with `envFromDotenv`, `mcpServers`. |
| `src/config.ts`                       | ✅ `CONTAINER_CONFIG_PATH`, `MOUNT_CONTEXT_DIR`, `MCP_CONTEXT_DIR` added.                                                                                       |
| `src/mount-security.ts`               | ✅ `loadContainerConfig()`, `getConfigMounts()`, `getConfigMcpServers()` + `ResolvedMcpServers` added. Resolves env vars, validates mounts, builds tool patterns. |
| `src/container-runner.ts`             | ✅ Config mounts + `readMountContext()` + mount-info CLAUDE.md. MCP: `readMcpContext()` + MCP mounts + mcp-info CLAUDE.md at `/workspace/extra/.mcp/` + top-level `envFromDotenv` Docker `-e` + enriched `ContainerInput` with resolved MCP config. Hardcoded seerr/github env var forwarding removed. |
| `src/container-config.test.ts`        | ✅ 40 tests total: loadContainerConfig (11), getConfigMounts (16), getConfigMcpServers (13).                                                                     |
| `src/container-runner.test.ts`        | ✅ Updated mount-security mock with `getConfigMcpServers`, `loadContainerConfig`. Added `MCP_CONTEXT_DIR`, `MOUNT_CONTEXT_DIR` to config mock. |
| `container/agent-runner/src/index.ts` | ✅ Additive MCP consumption: hardcoded base (nanoclaw + gmail) + config spread. Seerr/github removed from hardcoded. `setupGitConfig()` updated to use `GITHUB_PERSONAL_ACCESS_TOKEN`. `ContainerInput` extended. |
| `.env`                                | ✅ `GITHUB_TOKEN` removed, `GITHUB_PERSONAL_ACCESS_TOKEN` added. `NO_PROXY` added for OneCLI proxy bypass.                                                      |

**New host directories:**
- `~/.config/nanoclaw/mcp-context/` — MCP tool context files (markdown, same pattern as `mount-context/`)

**New file:** `~/.config/nanoclaw/container-config.json`
**Deprecated:** `~/.config/nanoclaw/mount-allowlist.json` (kept as fallback during migration)

---

## Implementation Phases

### Phase 1: Config Loading + Types — ✅ COMPLETE

- ✅ Defined `ContainerConfigFile`, `ConfigMount` interfaces in `src/types.ts`
- ✅ Added `CONTAINER_CONFIG_PATH` in `src/config.ts`
- ✅ Added `loadContainerConfig()` in `src/mount-security.ts` (not config.ts — colocated with mount helpers)
- ~~Write migration function~~ — decided against auto-migration. Manual config creation.

### Phase 2: Mount Unification — ✅ COMPLETE

- ✅ Added `getConfigMounts()` in `mount-security.ts`. `extraBlockedPatterns` extends hardcoded defaults. All changes additive — existing functions untouched.
- ✅ Added config mounts block in `container-runner.ts` `buildVolumeMounts()` (additive, stacks on top of existing DB + allowlist path)
- Gmail credential mount stays hardcoded — moves to config in MCP phase, not mount phase

See [mount-config-implementation.md](mount-config-implementation.md) for full details.

### Phase 2.5: Mount Context Files — ✅ COMPLETE

- ✅ Added `contextFile?: string` to `ConfigMount` — optional filename in `~/.config/nanoclaw/mount-context/`
- ✅ Added `MOUNT_CONTEXT_DIR` constant in `config.ts`, passthrough in `mount-security.ts`
- ✅ Added `readMountContext()` helper in `container-runner.ts` (with `path.basename()` traversal protection)
- ✅ Enriched `mount-info/CLAUDE.md` generation: `##` headings per mount with description + sidecar context
- ✅ Created context files for obsidian, repos, websites mounts
- ✅ Audited all group CLAUDE.md files — removed redundant mount docs from `main/` and `telegram_main/`, fixed stale references in `main/`

**Key outcome:** Mount documentation is now fully config-driven. Group CLAUDE.md files no longer contain mount-specific content — it's generated dynamically from `container-config.json` + context files at each container spawn.

### Phase 3: MCP + Env Vars via Stdin — ✅ COMPLETE

**3a. Types + Config Loading:**
- ✅ Added `McpServerConfig`, `McpServerMount` interfaces to `src/types.ts`
- ✅ Added `mcpServers?: Record<string, McpServerConfig>` and `envFromDotenv?: string[]` to `ContainerConfigFile`
- ✅ Added `MCP_CONTEXT_DIR` constant to `src/config.ts`
- ✅ Added `getConfigMcpServers()` + `ResolvedMcpServers` to `mount-security.ts`
- ✅ Extended `ContainerInput` (both copies) with `mcpServers`, `extraAllowedTools`, `extraDisallowedTools`

**3b. Container-runner — Build + Forward:**
- ✅ Per-server env vars go into stdin `mcpServers.{name}.env` ONLY (not Docker `-e`)
- ✅ Top-level `envFromDotenv` forwarded via Docker `-e` (for `setupGitConfig()` etc.)
- ✅ Per-server mounts forwarded via `buildVolumeMounts()`
- ✅ `extraAllowedTools`/`extraDisallowedTools` built and included in `ContainerInput`
- ✅ Hardcoded seerr/github env var forwarding removed (custom additions, not upstream)

**3c. MCP Context CLAUDE.md Generation:**
- ✅ `readMcpContext()` helper (same pattern as `readMountContext()`)
- ✅ Generated `CLAUDE.md` at `/workspace/extra/.mcp/` with `##` headings per server
- ✅ Created context files: `gmail.md`, `seerr.md`, `github.md` in `~/.config/nanoclaw/mcp-context/`

**3d. Agent-runner — Additive Consumption:**
- ✅ Hardcoded base (nanoclaw + gmail) always present. Config servers spread on top (object spread — same name = config wins).
- ✅ Tool lists: hardcoded base always present, config appends (array concat — duplicates harmless).
- ✅ Seerr/github removed from hardcoded list (custom additions). Gmail stays (upstream default).
- ✅ `setupGitConfig()` updated: reads `GITHUB_PERSONAL_ACCESS_TOKEN` with `GITHUB_TOKEN` fallback.

**Key design decision:** Initial implementation used either/or (replacement) logic. Corrected to additive — same pattern as config mounts. Two different merge behaviors: servers override (object spread, last wins), tool lists append (array concat, duplicates harmless).

**Operational changes:**
- ✅ `GITHUB_TOKEN` removed from `.env`, consolidated to `GITHUB_PERSONAL_ACCESS_TOKEN`
- ✅ `NO_PROXY=host.docker.internal,localhost,127.0.0.1` added to `.env` + top-level `envFromDotenv` (OneCLI proxy bypass for local MCP server traffic)
- ✅ Seerr MCP pinned to `@2.1.0` (v2.1.1 regression — config-only fix, no code change)
- ✅ 40 tests total (16 new for MCP config)

### Phase 4: Remaining Cleanup (Optional)

Most cleanup was done during Phase 3 (seerr/github removed from hardcoded). Remaining items:
- Gmail credential mount is duplicated (hardcoded in `buildVolumeMounts()` + config per-server mount). Harmless — Docker last-write-wins. Could remove hardcoded mount, but it's upstream code.
- Gmail disallowedTools duplicated (hardcoded list + config `disallowedTools`). Harmless — array concat.
- Consider removing gmail from hardcoded agent-runner entirely if upstream divergence is acceptable.

---

## Verification — ✅ ALL PASSED

1. ✅ **Mount test**: Config mounts work on next invocation
2. ✅ **MCP test**: Config-driven seerr/github tools available to agent
3. ✅ **MCP context test**: Generated CLAUDE.md at `data/sessions/{folder}/mcp-info/CLAUDE.md` includes descriptions + context file content
4. ✅ **Env var test**: Seerr env vars reach MCP server via stdin path. Verified with `getConfigMcpServers()` direct call.
5. ✅ **Security test**: 40 unit tests cover blocked patterns, extraBlockedPatterns, etc.
6. ✅ **Additive test**: Hardcoded servers (nanoclaw, gmail) remain when config adds servers on top
7. ✅ **Error handling test**: Unit tests cover missing config, missing .env keys (empty string), missing command (skip server), missing context file (description only)
8. ✅ **Env var separation**: `GITHUB_PERSONAL_ACCESS_TOKEN` reaches both container `process.env` (top-level envFromDotenv → Docker `-e`) and GitHub MCP server (per-server envFromDotenv → stdin)
9. ✅ **Tool allowlisting**: Unit tests verify `mcp__{name}__*` wildcard generation, `disallowedTools` prefixing, custom `allowedTools` override
10. ✅ **Full integration**: Telegram message → agent used config-based MCP servers with tool context. Version pin (`@2.1.0`) applied via config-only change.
11. ✅ **NO_PROXY**: OneCLI proxy bypass for local MCP server traffic (Seerr on `host.docker.internal`)
