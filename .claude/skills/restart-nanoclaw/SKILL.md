---
name: restart-nanoclaw
description: Use whenever NanoClaw has been updated or needs to be restarted. Quick restart for config/host changes, or full restart when agent-runner or container code changed.
---

# Restart NanoClaw

Determine which type of restart is needed, then execute.

## Decide: quick vs full restart

**Quick restart** — use when only host-side code changed (`src/`, `.env`, config):
- Rebuild host TypeScript
- Restart the service

**Full restart** — use when `container/agent-runner/` source changed (new MCP servers, tool changes, agent-runner logic):
- Rebuild host TypeScript
- Clear cached agent-runner copies (per-group caches are created once and never auto-updated)
- Rebuild the container image (if `container/Dockerfile` or dependencies changed)
- Restart the service

## Quick restart steps

1. **Build** host TypeScript:
   ```bash
   npm run build
   ```

2. **Restart the service:**

   Linux (systemd):
   ```bash
   systemctl --user restart nanoclaw
   ```

   macOS (launchd):
   ```bash
   launchctl kickstart -k gui/$(id -u)/com.nanoclaw
   ```

3. **Verify:**

   Linux:
   ```bash
   systemctl --user status nanoclaw --no-pager | head -10
   ```

   macOS:
   ```bash
   launchctl list | grep nanoclaw
   ```

## Full restart steps

1. **Build** host TypeScript:
   ```bash
   npm run build
   ```

2. **Clear cached agent-runner copies** so containers pick up new agent-runner source:
   ```bash
   rm -rf data/sessions/*/agent-runner-src
   ```

3. **Rebuild container image** (only if `container/Dockerfile` or `container/agent-runner/package.json` changed):
   ```bash
   ./container/build.sh
   ```

4. **Restart the service:**

   Linux (systemd):
   ```bash
   systemctl --user restart nanoclaw
   ```

   macOS (launchd):
   ```bash
   launchctl kickstart -k gui/$(id -u)/com.nanoclaw
   ```

5. **Verify:**

   Linux:
   ```bash
   systemctl --user status nanoclaw --no-pager | head -10
   ```

   macOS:
   ```bash
   launchctl list | grep nanoclaw
   ```
