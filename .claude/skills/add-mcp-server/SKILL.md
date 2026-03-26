---
name: add-mcp-server
description: Add an MCP tool server to the NanoClaw agent. Interactive — helps find servers, configures env vars, sets tool restrictions, and generates context files. Config-only, no code changes or restart needed. Triggers on "add mcp", "mcp server", "add tool server", or "new mcp".
---

# Add MCP Server

This skill adds an MCP tool server to NanoClaw's declarative config. No code changes or container rebuilds — edit the config, and the next agent execution picks it up.

**Config file:** `~/.config/nanoclaw/container-config.json`
**Context files:** `~/.config/nanoclaw/mcp-context/<name>.md`
**Env vars:** project-root `.env`

## Step 1: Pre-flight

Read `~/.config/nanoclaw/container-config.json`. If it doesn't exist, we'll create it in the write step.

If it exists, show the user which MCP servers are already configured:

```
Currently configured MCP servers: gmail, seerr, github (or "none" if mcpServers is empty/missing)
```

If the user's requested server already exists as a key in `mcpServers`, use AskUserQuestion to ask whether they want to **update** the existing entry or pick a different name. Do not create duplicates.

## Step 2: Identify the server

Use AskUserQuestion to determine what the user wants:

- **User provided a package name** (e.g. `@modelcontextprotocol/server-github`) — proceed directly.
- **User described a service** (e.g. "Google Calendar", "Notion", "Postgres") — use WebSearch to search for `mcp server <service> site:npmjs.com` and/or `mcp server <service> site:github.com`. Present the top 3-5 results with package name, description, and weekly downloads. Let the user pick.
- **User wants to browse** — search npmjs for `mcp server` and present popular options.

Once a package is chosen, use WebFetch on the npm page (`https://www.npmjs.com/package/<package>`) or the GitHub README to learn:
- Required environment variables
- Available tools
- Any credential/config directories needed
- Invocation method

## Step 3: Determine command format and version

### Command format

Detect the invocation pattern:

- **npx (most common):** `"command": "npx", "args": ["-y", "@scope/package@version"]`
- **node (local/custom):** `"command": "node", "args": ["/path/to/server.js"]`
- **Python (uvx/python -m):** Warn the user — the agent container image is `node:22-slim` with no Python runtime. Suggest searching for an npx-based alternative. If none exists, note that adding Python would require a container image rebuild (`./container/build.sh` with Dockerfile changes).

### Version pinning

Check the package's latest version. Use AskUserQuestion to recommend pinning:

> The latest version of `<package>` is `<version>`. I recommend pinning to this version:
> ```json
> "args": ["-y", "@scope/package@1.2.3"]
> ```
> Unpinned `npx -y` fetches the latest on every cold container start — if a new version has a regression, the agent breaks without warning. (The existing seerr config pins `@2.1.0` for exactly this reason.)
>
> Pin to `<version>`, or leave unpinned?

If the user prefers not to pin, that's fine — use the bare package name.

## Step 4: Choose server name

Derive a short, descriptive key from the package name and use AskUserQuestion to confirm:

> I suggest naming this server `<suggested>` (derived from the package name). This name becomes the config key and the tool prefix (`mcp__<name>__*`). Does that work, or would you prefer a different name?

Examples of good names:
- `@modelcontextprotocol/server-github` -> `github`
- `@gongrzhe/server-gmail-autoauth-mcp` -> `gmail`
- `@jhomen368/overseerr-mcp` -> `seerr`

**Reserved names — must block:**
- `nanoclaw` — the IPC server, always hardcoded. Overriding it breaks agent communication entirely.

**Reserved names — warn:**
- `gmail` — upstream default, always hardcoded in agent-runner. A config entry with the same name intentionally overrides the hardcoded version (object spread, last wins). Only use `gmail` if intentionally reconfiguring the upstream Gmail setup.

Check for conflicts with existing `mcpServers` keys in the config.

## Step 5: Gather environment variables

Based on what we learned from the package README in Step 2, present the required env vars and use AskUserQuestion to gather values.

**Critical: Env var path distinction.** There are two separate delivery paths — placing a var in the wrong one means the MCP server won't see it:

- **Per-server `envFromDotenv`** — Read from `.env` on host, delivered via stdin JSON to the MCP SDK, which injects them into the MCP server child process. The MCP server process **only** sees these + a minimal default set (`HOME`, `PATH`, `SHELL`, `TERM`, `USER`, `LOGNAME`). **Use this for all MCP-server-specific vars** (API keys, URLs, tokens).

- **Top-level `envFromDotenv`** — Read from `.env` on host, forwarded via Docker `-e` flags into the container's `process.env`. The MCP server child process does **NOT** see these. Use this only for vars needed by agent-runner code (e.g., `GIT_USER_NAME`, `GITHUB_PERSONAL_ACCESS_TOKEN` for git auth).

For each env var:
1. Ask the user for the value
2. Add `KEY=value` to the project-root `.env` file (skip if key already exists — inform the user)
3. Add the key name to the per-server `envFromDotenv` array in the config entry

## Step 6: Local service connectivity

Check if any env var values contain `localhost`, `127.0.0.1`, or `0.0.0.0` in a URL.

If so, use AskUserQuestion to confirm: "This URL points to a service on your host machine. MCP servers run inside Docker containers where `localhost` refers to the container itself, not your host. I'll rewrite it to `host.docker.internal` so the MCP server can reach your host."

Then:
1. Rewrite the URL in `.env` (e.g., `http://localhost:8096` -> `http://host.docker.internal:8096`)
2. Ensure `NO_PROXY` in `.env` includes `host.docker.internal` (append if needed, don't duplicate). This bypasses the OneCLI credential proxy for local traffic.
3. Ensure `NO_PROXY` is listed in the **top-level** `envFromDotenv` array in the config (not per-server — it needs to be in the container's `process.env`).

## Step 7: Tool restrictions

Use AskUserQuestion:

> Should any tools from this server be restricted?
> - **(a) Allow all tools** (default) — the agent can use everything the server provides
> - **(b) Block specific tools** — list tools to disable (e.g., `send_email`, `delete_repository`)
> - **(c) Only allow specific tools** — whitelist only the tools you want

If (b): Gather tool names as bare names (no prefix). Add to `disallowedTools` array. The system auto-prefixes with `mcp__<name>__` at runtime.

If (c): Gather tool names. Add to `allowedTools` array. This overrides the default `mcp__<name>__*` wildcard.

If the user isn't sure what tools are available, check the package README or suggest they add the server first with no restrictions, test it, and come back to add restrictions later.

## Step 8: Credential mounts

Use AskUserQuestion if the package README mentions needing config directories, credential files, or OAuth tokens:

> Does this server need any host directories mounted into the container? (e.g., OAuth credential directories, config folders)

If yes, for each mount gather:
- **hostPath**: Absolute path on host (`~` supported). Validate it exists.
- **containerPath**: **Absolute** path inside the container (e.g., `/home/node/.gmail-mcp`). This must match where the MCP server expects its files. Note: this is different from regular volume mounts which use relative paths under `/workspace/extra/`.
- **readWrite**: Does the server need to write to this directory? (e.g., OAuth token refresh)

## Step 9: Write config

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

### Add the server entry

Read the existing config, add the new entry under `mcpServers` (create the `mcpServers` object if it doesn't exist), and write back. Also add `description` and `contextFile` fields (context file is created in the next step).

Ensure `~/.config/nanoclaw/mcp-context/` exists (`mkdir -p`).

### Validate

After writing, re-read the file and verify:
- Valid JSON
- `version` is `1`
- `mounts` is an array
- `security` section has `extraBlockedPatterns` (array) and `nonMainReadOnly` (boolean)
- The new server entry is present under `mcpServers`

## Step 10: Generate context file

Context files tell the agent what the MCP server does and how to use it. They are injected into a generated CLAUDE.md that the agent reads at startup.

Use AskUserQuestion to gather information:

> I'll create a context file so the agent knows how to use this server. A few questions:
> 1. In a sentence or two, what is this server for?
> 2. Are there any restrictions or things the agent should NOT do with it?
> 3. Any tips, conventions, or behavioral rules? (e.g., "always confirm before deleting", "prefer X over Y")

Draft a concise context file based on their answers and what we learned from the package README. Show it to the user for approval.

**Existing context files for reference:**

`gmail.md` (5 lines):
```
Read-only email access. You can search, read messages, read threads, list labels, and list/read drafts.

**You are FORBIDDEN from sending emails.** All write tools (send, modify, delete, create labels/filters) are blocked. If asked to send an email, create a draft instead and tell the user you've drafted it for their review.

When you receive an email notification (messages starting with `[Email from ...`), inform the user about it but do NOT reply to the email unless specifically asked.
```

`seerr.md` (1 line):
```
Search for movies and TV shows, request media, check request status, view pending requests, and browse trending content. Connected to the Jellyseerr instance on the local network.
```

Write to `~/.config/nanoclaw/mcp-context/<name>.md` and set `contextFile: "<name>.md"` in the config entry.

## Step 11: Restart NanoClaw

Invoke the `/restart-nanoclaw` skill to restart the service. This is a config-only change — a quick restart is sufficient (no build or cache clearing needed).

## Step 12: Summary

Show the user:
1. The full config entry that was added (formatted JSON)
2. The context file path and contents
3. Any env vars that were added to `.env`
4. Any `NO_PROXY` changes

Then explain:

> NanoClaw has been restarted. The new MCP server will be available on the **next agent message** that spawns a new container.
>
> **To undo:** Remove the `<name>` block from `mcpServers` in `~/.config/nanoclaw/container-config.json`, remove any added env vars from `.env`, and delete `~/.config/nanoclaw/mcp-context/<name>.md`. Then restart: `systemctl --user restart nanoclaw`. To restore the previous config: `cp ~/.config/nanoclaw/container-config.json.bak ~/.config/nanoclaw/container-config.json`

## Troubleshooting

### Agent says the tools aren't available

1. Verify the entry is in `container-config.json` under `mcpServers`
2. Check that any required env vars are in `.env` with correct values
3. Trigger a new agent message (existing sessions won't see config changes)

### MCP server can't connect to a local service

1. Verify the URL uses `host.docker.internal` not `localhost`
2. Check that `NO_PROXY` includes `host.docker.internal` in `.env`
3. Check that `NO_PROXY` is in top-level `envFromDotenv` in the config
4. Verify the service is actually running and listening on the expected port

### MCP server crashes or times out

1. Check container logs: `tail -f logs/nanoclaw.log`
2. Verify the package exists and the version is valid: `npm view @scope/package@version`
3. If unpinned, try pinning to a known-good version
4. Check if the server needs a credential mount that wasn't configured
