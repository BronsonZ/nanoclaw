---
name: deploy-service
description: >
  Deploy a new Docker service on the homeserver with Caddy reverse proxy and
  Pi-hole DNS. Use when asked to set up, deploy, expose, or create a new
  service, web app, or Docker stack. Also use when adding a Caddy route or
  DNS record for an existing service.
---

# Deploy Service

Full workflow for deploying a new Docker service with reverse proxy and DNS on the homeserver.

## Container Conventions

All new compose stacks should follow these patterns:

```yaml
services:
  myapp:
    image: lscr.io/linuxserver/myapp:latest  # or any image
    container_name: myapp
    restart: unless-stopped
    environment:
      - TZ=America/New_York
      - PUID=1000
      - PGID=1000    # some stacks use 1001
    volumes:
      - ./myapp/config:/config
    ports:
      - "8080:8080"  # only if direct access needed outside Caddy
networks:
  default:
    name: docker_network
    external: true
```

Key rules:
- `restart: unless-stopped` on all services
- `TZ=America/New_York` always
- `PUID=1000`, `PGID=1000` for LinuxServer.io images
- Join `docker_network` if the service needs Caddy proxying or inter-stack communication
- See `/workspace/extra/docker-stacks/CLAUDE.md` for full conventions

## Discover Used Ports

Before picking a port:
```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}' | grep -v "^NAMES"
```

## Caddy Reverse Proxy

Config: `/workspace/extra/docker-stacks/caddy/caddy/Caddyfile`
Env vars: `MY_PUBLIC_DOMAIN` (bzserver.com), `MY_LOCAL_DOMAIN` (bzserver.lan)

### Private service (`*.bzserver.lan`)

Most services go here. HTTP only, IP-restricted to LAN/Tailscale:

```
http://myapp.{$MY_LOCAL_DOMAIN} {
    import local_only
    reverse_proxy myapp:8080
}
```

For host-networked services, use the host IP:
```
http://myapp.{$MY_LOCAL_DOMAIN} {
    import local_only
    reverse_proxy 192.168.1.151:PORT
}
```

### Public service (`*.bzserver.com`)

Rare — only for services friends/family need. HTTPS with automatic Let's Encrypt:

```
myapp.{$MY_PUBLIC_DOMAIN} {
    reverse_proxy myapp:8080
}
```

**Ask Bronson to add a Cloudflare DNS record** — you cannot do this yourself.
Also add a Pi-hole CNAME for split-DNS: `myapp.bzserver.com` → `bzserver.com`.

### Sub-path routing

To serve an app under a sub-path of an existing domain (e.g., `claw.bzserver.lan/myapp/`):
```
redir /myapp /myapp/ 301
handle_path /myapp/* {
    reverse_proxy myapp:8080
}
```
The app's frontend must use relative paths (or a `<base href="/myapp/">` tag) for this to work. Most third-party apps don't support this — prefer subdomains.

### Restart Caddy

```bash
docker restart caddy
```

## Pi-hole DNS Management

API: `http://host.docker.internal:8383/api/`
Server IP: `192.168.1.151`

### Authenticate

```bash
SID=$(curl -s -X POST http://host.docker.internal:8383/api/auth \
  -d "{\"password\":\"$PIHOLE_PASSWORD\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['session']['sid'])")
```

### DNS Operations

```bash
# List A records
curl -s -H "X-FTL-SID: $SID" http://host.docker.internal:8383/api/config/dns/hosts

# List CNAME records
curl -s -H "X-FTL-SID: $SID" http://host.docker.internal:8383/api/config/dns/cnameRecords

# Add CNAME for *.bzserver.lan service
curl -s -X PUT -H "X-FTL-SID: $SID" \
  http://host.docker.internal:8383/api/config/dns/cnameRecords/myapp.bzserver.lan,bzserver.lan,300

# Add CNAME for *.bzserver.com split-DNS (public services only)
curl -s -X PUT -H "X-FTL-SID: $SID" \
  http://host.docker.internal:8383/api/config/dns/cnameRecords/myapp.bzserver.com,bzserver.com,300

# Add A record for a new domain (e.g., claw.lan)
curl -s -X PUT -H "X-FTL-SID: $SID" \
  http://host.docker.internal:8383/api/config/dns/hosts/192.168.1.151%20claw.lan

# Remove a CNAME
curl -s -X DELETE -H "X-FTL-SID: $SID" \
  http://host.docker.internal:8383/api/config/dns/cnameRecords/myapp.bzserver.lan,bzserver.lan,300
```

All `*.bzserver.lan` CNAMEs point to `bzserver.lan`. All `*.bzserver.com` CNAMEs point to `bzserver.com`. Both resolve to `192.168.1.151`.

## New Local Domains

To create an entirely new local domain (e.g., `*.claw.lan`):
1. Add a Pi-hole A record: `claw.lan` → `192.168.1.151`
2. Add CNAME records for subdomains: `app.claw.lan` → `claw.lan`
3. Add Caddy `http://` routes with `import local_only`
4. Tailscale global DNS (Pi-hole) ensures these resolve for remote devices too

## Checklist

For a new **private** service:
- [ ] Create compose file in `/workspace/extra/docker-stacks/myapp/`
- [ ] Start: `cd /workspace/extra/docker-stacks/myapp && docker compose up -d`
- [ ] Add Caddy `http://` block with `import local_only`
- [ ] Add Pi-hole CNAME: `myapp.bzserver.lan` → `bzserver.lan`
- [ ] Restart Caddy: `docker restart caddy`
- [ ] Verify: `curl -s -H "Host: myapp.bzserver.lan" http://192.168.1.151`

For a new **public** service (add all private steps plus):
- [ ] Use HTTPS Caddy block (no `http://` prefix, no `local_only`)
- [ ] Ask Bronson to add Cloudflare DNS record
- [ ] Add Pi-hole CNAME: `myapp.bzserver.com` → `bzserver.com`
