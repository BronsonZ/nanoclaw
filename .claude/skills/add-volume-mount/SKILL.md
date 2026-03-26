---
name: add-volume-mount
description: Add a host directory mount to the NanoClaw agent container. Interactive — validates paths, checks security rules, and generates context files. Config-only, no code changes or restart needed. Triggers on "add mount", "mount directory", "add volume", "volume mount", or "mount folder".
---

# Add Volume Mount

This skill mounts a host directory into the NanoClaw agent container so the agent can read (and optionally write) files there. No code changes or container rebuilds — edit the config, and the next agent execution picks it up.

**Config file:** `~/.config/nanoclaw/container-config.json`
**Context files:** `~/.config/nanoclaw/mount-context/<name>.md`
**Container path:** `/workspace/extra/<containerPath>`

## Step 1: Pre-flight

Read `~/.config/nanoclaw/container-config.json`. If it doesn't exist, we'll create it in the write step.

If it exists, show the user what's already mounted:

```
Currently configured mounts:
  ~/ObsidianVault -> /workspace/extra/obsidian (read-write, main only)
  ~/nanoclaw/repos -> /workspace/extra/repos (read-write, main only)
  (or "none" if mounts is empty)
```

## Step 2: Gather host path

Use AskUserQuestion:

> What directory do you want to mount into the agent container? Provide the full path (~ is supported, e.g. `~/Documents/notes`).

### Validate the path

1. **Check existence.** If the path doesn't exist, use AskUserQuestion:
   > That directory doesn't exist yet. Would you like me to create it? (`mkdir -p <path>`)

   Create it if they agree. If they decline, stop — the mount will be silently skipped at runtime if the path doesn't exist.

2. **Resolve symlinks.** Note that symlinks are resolved to their real path for security checks. If the resolved path differs from what the user provided, mention it.

3. **Check blocked patterns.** The following patterns are **always** blocked (hardcoded, cannot be overridden):

   `.ssh`, `.gnupg`, `.gpg`, `.aws`, `.azure`, `.gcloud`, `.kube`, `.docker`, `credentials`, `.env`, `.netrc`, `.npmrc`, `.pypirc`, `id_rsa`, `id_ed25519`, `private_key`, `.secret`

   Also check against any `extraBlockedPatterns` from the config's `security` section.

   If the path matches a blocked pattern, explain which pattern matched and why:
   > This path matches the blocked pattern `<pattern>`. Paths containing credentials, secrets, or cloud provider configs are blocked from being mounted into containers for security. This restriction is hardcoded and cannot be bypassed via config.

4. **Check for overlaps** with existing mounts. If the user's path is the same as, a parent of, or a child of an existing mount's host path, warn them:
   > Note: `~/nanoclaw` is a parent directory of the existing mount `~/nanoclaw/repos`. Both will be mounted independently — changes to overlapping files could be confusing.

## Step 3: Container path

Use AskUserQuestion. Suggest a default derived from the basename of the host path:

> Inside the container, this will be accessible at `/workspace/extra/<name>`. I suggest `<basename>` — does that work, or would you prefer a different name?

### Validate

- Must not be empty
- Must not be absolute (no leading `/`)
- Must not contain `..`
- Must not collide with an existing mount's `containerPath`. If it does, suggest an alternative (e.g., append `-2` or use a more specific name).

## Step 4: Access mode

Use AskUserQuestion:

> Should the agent have **read-write** or **read-only** access to this directory?

Explain the interaction with group scoping:

> Note: The security config has `nonMainReadOnly: true`, which means non-main groups are forced to read-only regardless of this setting. Only the main conversation group respects the read-write flag.

## Step 5: Scope

Use AskUserQuestion:

> Should this mount be available to **all groups** or just the **main group**?
>
> - **Main group only** (default) — only the primary conversation group gets this mount
> - **All groups** — every conversation group gets it, but non-main groups will have read-only access (due to `nonMainReadOnly: true`)

Set `allGroups` accordingly (omit or `false` for main-only, `true` for all).

## Step 6: Description

Use AskUserQuestion:

> Provide a short one-line description of this directory (e.g., "Personal notes vault", "Project source code", "Docker compose stacks").

## Step 7: Write config

### Backup

```bash
cp ~/.config/nanoclaw/container-config.json ~/.config/nanoclaw/container-config.json.bak
```

Skip if the file doesn't exist yet.

### Scaffold if needed

If `container-config.json` doesn't exist, create it:

```json
{
  "version": 1,
  "mounts": [],
  "security": {
    "extraBlockedPatterns": [],
    "nonMainReadOnly": true
  }
}
```

### Add the mount entry

Read the existing config, append the new mount to the `mounts` array, and write back. Include `description` and `contextFile` fields (context file is created in the next step).

Example entry:

```json
{
  "path": "~/Documents/notes",
  "containerPath": "notes",
  "readWrite": true,
  "allGroups": false,
  "description": "Personal markdown notes",
  "contextFile": "notes.md"
}
```

Ensure `~/.config/nanoclaw/mount-context/` exists (`mkdir -p`).

### Validate

After writing, re-read the file and verify:
- Valid JSON
- `version` is `1`
- `mounts` is an array containing the new entry
- `security` section has `extraBlockedPatterns` (array) and `nonMainReadOnly` (boolean)

## Step 8: Generate context file

Context files tell the agent what a mounted directory contains and how to use it. They are injected into a generated CLAUDE.md that the agent reads at startup. This is the **only** way the agent learns about mount contents — a good context file is the difference between a useful mount and a confusing one.

Use AskUserQuestion to gather information:

> I'll create a context file so the agent knows how to use this directory. A few questions:
> 1. What does this directory contain?
> 2. How should the agent use it? (e.g., "read-only reference", "create and edit files", "only modify specific subdirectories")
> 3. Any naming conventions, directory structure, or restrictions?

Draft a concise context file based on their answers. Show it to the user for approval.

**Existing context files for reference (range from 1 to 37 lines):**

`repos.md` (1 line):
```
Clone repos into this directory. This is BronsonZ's personal GitHub account.
```

`websites.md` (1 line):
```
Subdirectories map to URL paths (e.g., `websites/foo/index.html` serves at `/foo/`). Use this for hosting static HTML, dashboards, or anything that needs a web UI.
```

`obsidian.md` (37 lines — detailed, with usage examples, primary directory, and guidelines):
```
You have read-write access to an Obsidian vault. Files written here sync to the user's phone via Obsidian Sync.

### Usage
- Create and edit Markdown files (`.md`) in this directory
- Use standard Obsidian-compatible Markdown: headings, links (`[[note]]`), tags (`#tag`), frontmatter (YAML)
...
```

Match the detail level to complexity — simple directories get 1-3 lines, complex ones with conventions get more.

Write to `~/.config/nanoclaw/mount-context/<name>.md` and set `contextFile: "<name>.md"` in the config entry.

## Step 9: Restart NanoClaw

Invoke the `/restart-nanoclaw` skill to restart the service. This is a config-only change — a quick restart is sufficient (no build or cache clearing needed).

## Step 10: Summary

Show the user:
1. The mount entry that was added (formatted JSON)
2. The effective container path: `/workspace/extra/<containerPath>`
3. The context file path and contents
4. Access mode and scope

Then explain:

> NanoClaw has been restarted. The new mount will be available on the **next agent message** that spawns a new container.
>
> **To undo:** Remove the mount entry from the `mounts` array in `~/.config/nanoclaw/container-config.json` and delete `~/.config/nanoclaw/mount-context/<name>.md`. Then restart: invoke `/restart-nanoclaw`. To restore the previous config: `cp ~/.config/nanoclaw/container-config.json.bak ~/.config/nanoclaw/container-config.json`

## Troubleshooting

### Agent can't see the mounted directory

1. Verify the entry is in `container-config.json` under `mounts`
2. Check that the host path exists — mounts to nonexistent paths are silently skipped
3. Trigger a new agent message (existing sessions won't see config changes)
4. If using `allGroups: false` (default), verify you're messaging from the main group

### Agent can't write to the directory

1. Check `readWrite` is `true` in the mount config
2. If this is a non-main group, `nonMainReadOnly: true` forces read-only regardless
3. Check host directory permissions — the container runs as your user (UID match)

### Mount was silently skipped

Check container logs for warnings: `tail -f logs/nanoclaw.log | grep -i mount`

Common causes:
- Host path doesn't exist
- Path matches a blocked security pattern
- Invalid `containerPath` (contains `..`, is absolute, or is empty)
