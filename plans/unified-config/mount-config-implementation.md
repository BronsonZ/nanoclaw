# Mount Config Implementation — COMPLETE

Sub-plan of [unified-container-config.md](unified-container-config.md). Implements **mounts only** — MCP servers and env vars come later.

**Status:** Implemented and deployed. Branch: `custom`. Config file live at `~/.config/nanoclaw/container-config.json`.

**Phase 2.5 (context files):** Also complete. See "Sidecar Mount Context Files" section below.

---

## Current State

**Two-layer system:**

1. **Allowlist file** (`~/.config/nanoclaw/mount-allowlist.json`):
   - Defines what's _allowed_ to be mounted (`allowedRoots`)
   - Has `blockedPatterns` (merged with hardcoded defaults), `nonMainReadOnly`
   - Read by `mount-security.ts`, cached for process lifetime

2. **Per-group DB column** (`registered_groups.container_config` JSON):
   - Defines what's _requested_ to be mounted (`additionalMounts`)
   - Main group DB config was cleared after config file was created

3. **Hardcoded mounts** in `container-runner.ts buildVolumeMounts()`:
   - Core: project root, group dir, .claude sessions, IPC, agent-runner-src
   - Gmail: `~/.gmail-mcp` (lines 169-178) — stays hardcoded until MCP config phase

**Flow:** DB request → `validateAdditionalMounts()` → check allowlist → check blocked patterns → check allowed roots → determine effective readonly → mount if valid.

---

## Target State

**Single config file** (`~/.config/nanoclaw/container-config.json`):

```json
{
  "version": 1,
  "mounts": [
    {
      "path": "~/ObsidianVault",
      "containerPath": "obsidian",
      "readWrite": true,
      "allGroups": false,
      "description": "Obsidian vault for note editing"
    }
  ],
  "security": {
    "extraBlockedPatterns": [],
    "nonMainReadOnly": true
  }
}
```

**Mount scope:** Each mount defaults to main group only (`allGroups: false`). Set `"allGroups": true` to mount for all groups. When `allGroups` is true, `security.nonMainReadOnly` applies — non-main groups get the mount read-only regardless of the mount's `readWrite` setting.

**New flow:** Read config → check blocked patterns → mount. These mounts are **additive** — they stack on top of whatever the existing DB + allowlist path already produces.

**Everything existing is untouched.** The DB path, the allowlist, the validation — all run exactly as before for all groups, including main. The config mounts are a new source of mounts, not a replacement for the old source.

**Gmail mount:** Stays hardcoded in `buildVolumeMounts()` for now. Moves to per-server MCP config in a later phase.

---

## What Changes

### 1. `src/types.ts` — New interfaces

```typescript
export interface ContainerConfigFile {
  version: number;
  mounts: ConfigMount[];
  security: {
    extraBlockedPatterns: string[];
    nonMainReadOnly: boolean;
  };
}

export interface ConfigMount {
  path: string;
  containerPath: string;
  readWrite: boolean;
  allGroups?: boolean;
  description?: string;
}
```

Keep existing `AdditionalMount`, `MountAllowlist`, `AllowedRoot` interfaces — they're still used by the existing DB + allowlist path (which always runs).

### 2. `src/config.ts` — New constant

```typescript
export const CONTAINER_CONFIG_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'container-config.json',
);
```

### 3. `src/mount-security.ts` — Two new functions

Everything existing is untouched. Two new exports are added.

**`loadContainerConfig(): ContainerConfigFile | null`**

- Reads `CONTAINER_CONFIG_PATH` fresh each call (no cache)
- Parses JSON, validates `version === 1` and required fields
- Returns `null` silently on missing file; logs error on invalid JSON or wrong version

**`getConfigMounts(isMain: boolean): Array<{ hostPath: string; containerPath: string; readonly: boolean }> | null`**

- Calls `loadContainerConfig()`. Returns `null` if no config.
- Filters mounts by scope: include if `isMain`, or if mount has `allGroups: true`
- For each included mount:
  - Expands `~` via existing `expandPath()`
  - Resolves real path via existing `getRealPath()` — skip + warn if path doesn't exist
  - Checks against `DEFAULT_BLOCKED_PATTERNS` + `config.security.extraBlockedPatterns` via existing `matchesBlockedPattern()` — skip + warn if blocked
  - Validates containerPath via existing `isValidContainerPath()`
  - If `!isMain` and `config.security.nonMainReadOnly`: force readonly regardless of mount's `readWrite`
- Returns ready-to-use array (same shape as `validateAdditionalMounts()` return type)

No changes to `loadMountAllowlist()`, `validateMount()`, `validateAdditionalMounts()`, or any other existing function.

### 5. `src/container-config.test.ts` — 22 new tests

Tests for `loadContainerConfig` (8 tests): missing file, valid config, invalid JSON, wrong version, bad mounts, missing security, bad extraBlockedPatterns, bad nonMainReadOnly.

Tests for `getConfigMounts` (14 tests): no config, empty mounts, main group mounts, non-main filtering, allGroups inclusion, invalid container path, missing host path, blocked patterns, extraBlockedPatterns, readonly flags, nonMainReadOnly enforcement, /workspace/extra/ prefix, mixed validity.

### 6. `src/container-runner.test.ts` — Mock update

Added `getConfigMounts: vi.fn(() => null)` to the mount-security mock so existing tests pass with the new import.

### 4. `src/container-runner.ts` — Add config mounts on top of existing code

**In `buildVolumeMounts()`**, add config mounts **before** the existing additionalMounts block (lines 216-224). The existing block is completely unchanged and always runs.

```typescript
// New: config-driven mounts (additive — does not replace existing mounts)
const configMounts = getConfigMounts(isMain);
if (configMounts) {
  mounts.push(...configMounts);
}

// Existing code, unchanged — DB additionalMounts + allowlist validation
if (group.containerConfig?.additionalMounts) {
  const validatedMounts = validateAdditionalMounts(
    group.containerConfig.additionalMounts,
    group.name,
    isMain,
  );
  mounts.push(...validatedMounts);
}
```

Both paths run independently. Config mounts and DB mounts stack. The existing architecture is untouched for all groups.

> **Note:** If the same container path appears in both config and DB (e.g. Obsidian in both), it's mounted twice. Docker uses the last `-v` flag for duplicate container paths, so the DB mount would win. This is harmless — once you're happy with the config, you can clear the DB entry at your leisure. No rush, no breakage either way.

### 5. No Migration — Manual Cutover

No auto-migration. When ready, manually create `~/.config/nanoclaw/container-config.json`. Until then, the old allowlist + DB path works exactly as before.

The old system (`mount-allowlist.json` + DB `additionalMounts`) is never modified or removed by this change. Both paths always run independently — the old path produces the same mounts it always has, and the new config path adds on top (or adds nothing if the file is absent).

---

## What Does NOT Change

Nothing in the existing implementation is modified or removed. All changes are additive.

- **`mount-allowlist.json`** — untouched on disk, code path unchanged. Always loaded when DB additionalMounts exist, regardless of whether `container-config.json` is present.
- **`loadMountAllowlist()`** — function body, caching, and behavior are unchanged. Always called when DB additionalMounts exist.
- **`validateMount()`, `validateAdditionalMounts()`** — signatures and logic unchanged. Always called when DB additionalMounts exist.
- **DB `containerConfig.additionalMounts`** — still read, still validated via allowlist, for all groups including main. Config mounts are additive on top, not a replacement.
- **Gmail hardcoded mount** (lines 169-178) — untouched, moves to MCP config in a later phase.
- **Core mounts** (project root, group dir, .claude, IPC, agent-runner-src) — always hardcoded, untouched.
- **`DEFAULT_BLOCKED_PATTERNS`** — always applied, never removable via config.
- **`AdditionalMount`, `MountAllowlist`, `AllowedRoot` types** — kept, unchanged.
- **`generateAllowlistTemplate()`** — kept, unchanged.

---

## Error Handling

| Scenario                                | Behavior                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `container-config.json` missing         | Config path contributes nothing. Old code path runs as always.                 |
| `container-config.json` invalid JSON    | Log error, config path contributes nothing. Old code path runs as always.      |
| `container-config.json` wrong version   | Log error, config path contributes nothing. Old code path runs as always.      |
| Config mount path doesn't exist on host | Warn and skip that mount                                                       |
| Config mount matches blocked pattern    | Warn and skip that mount                                                       |
| Both config and allowlist missing       | All additional mounts blocked (current behavior, unchanged)                    |

---

## Verification

1. Create `container-config.json` with Obsidian mount → send message → verify `/workspace/extra/obsidian` is mounted writable in container
2. Add a new mount to config → send another message (no restart) → verify new mount appears
3. Remove a mount from config → verify it's gone on next invocation
4. Add `~/.ssh` to config → verify blocked pattern prevents it
5. Delete `container-config.json` → verify fallback to `mount-allowlist.json` works
6. Delete both config files → verify all additional mounts are blocked (graceful)

---

## Phase 2.5: Sidecar Mount Context Files — COMPLETE

**Problem:** Short `description` strings in the config were insufficient for agents to know *how* to use mounts. Group CLAUDE.md files contained manually maintained mount documentation (Obsidian vault usage, GitHub conventions, website serving details) that duplicated config info and went stale.

**Solution:** Optional `contextFile` field per mount in `container-config.json`, pointing to a markdown file in `~/.config/nanoclaw/mount-context/`. Content is injected into the generated `mount-info/CLAUDE.md` at container spawn time.

### Config Example

```json
{
  "path": "~/ObsidianVault",
  "containerPath": "obsidian",
  "readWrite": true,
  "description": "Obsidian vault for note editing",
  "contextFile": "obsidian.md"
}
```

Resolves to `~/.config/nanoclaw/mount-context/obsidian.md`.

### Generated Output

The `mount-info/CLAUDE.md` changed from bullet list to `##` headings with injected context:

```markdown
# Additional Mounted Directories

## `/workspace/extra/obsidian` (read-write)

Obsidian vault for note editing

[full content of ~/.config/nanoclaw/mount-context/obsidian.md]

## `/workspace/extra/repos` (read-write)

Directory for code repositories

[content of repos.md context file]
```

### Files Changed

| File | Change |
|------|--------|
| `src/types.ts` | Added `contextFile?: string` to `ConfigMount` |
| `src/config.ts` | Added `MOUNT_CONTEXT_DIR` constant |
| `src/mount-security.ts` | Pass `contextFile` through in `getConfigMounts` return type + mount object |
| `src/container-runner.ts` | Added `readMountContext()` helper (path traversal protection via `path.basename()`), enriched CLAUDE.md generation with `##` headings + context injection |
| `src/container-config.test.ts` | Added 2 tests for contextFile passthrough (24 total, up from 22) |

### Current Context Files

| File | Content |
|------|---------|
| `~/.config/nanoclaw/mount-context/obsidian.md` | Vault usage, primary directory (`NanoClaw/`), guidelines, examples |
| `~/.config/nanoclaw/mount-context/repos.md` | GitHub clone conventions |
| `~/.config/nanoclaw/mount-context/websites.md` | Caddy serving details, URL path mapping |

### CLAUDE.md Audit (Post Context Files)

After adding context files, audited all group CLAUDE.md files and removed redundancy:

- **`groups/main/CLAUDE.md`** — Removed 130+ lines duplicating global CLAUDE.md. Removed stale Container Mounts table and Obsidian section. Fixed stale references (`registered_groups.json` → SQLite, WhatsApp-only → multi-channel, wrong global CLAUDE.md path).
- **`groups/telegram_main/CLAUDE.md`** — Removed mount-specific sections (Obsidian, GitHub, Websites) and Container Mounts table. Now served dynamically via mount-info.
- **`groups/global/CLAUDE.md`** — Clean, no changes needed.

**Layering principle:** Global CLAUDE.md = identity/config (system prompt). Mount context files = mount documentation (generated per-session). MCP context files = tool documentation (generated per-session, at `/workspace/extra/.mcp/`). Group CLAUDE.md = group-specific operational context only.

> **Note:** MCP tool context files follow the same pattern — `~/.config/nanoclaw/mcp-context/`, `description` + `contextFile` per server, generated CLAUDE.md at `/workspace/extra/.mcp/`. See Phase 3 in [unified-container-config.md](unified-container-config.md).

---

## Design Principles

- **One file, one edit, done.** The config file is the single source of truth for mounts. If a mount is declared in the config, it's mounted — no separate allowlist-then-request dance, no SQLite query. Edit the JSON, restart NanoClaw, the agent has the folder.
- **Purely additive.** No existing code is modified or removed. New code paths are gated behind the presence of `container-config.json`.
- **No migration.** Config file is created manually when ready. Until then, everything works exactly as before.
- **No cache for new path.** `loadContainerConfig()` reads fresh each invocation. Existing `loadMountAllowlist()` keeps its cache — it's unchanged.
- **Fallback is the old system, not partial behavior.** If the new config is absent or broken, the entire old code path runs — not a mix of old and new.
