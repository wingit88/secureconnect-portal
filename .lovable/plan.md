
# Plan: MikroTik Captive Portal + Self-Hosted Next.js Backend

You've chosen to keep the spec exactly as written (Next.js 14 + Prisma + SQLite), self-host on a Linux box at `192.168.10.2` on VLAN 10, and use a locally-running secure auth (not HTTP Basic, not Lovable Cloud).

Because this Lovable project runs on TanStack Start (not Next.js), the deliverable will be written as a **reference bundle** committed into a `docs/captive-portal/` folder in this repo. You'll copy that folder to your server and run it there — nothing in the bundle executes inside the Lovable preview.

## What you'll get

### 1. `docs/captive-portal/README.md`
Top-level walkthrough: hardware assumptions, IP plan, deployment order (router first, then server), how to test end-to-end, troubleshooting (walled garden misses, MAC normalization, API port blocked).

### 2. `docs/captive-portal/mikrotik/setup.rsc`
A single paste-and-go RouterOS script, fully commented, starting from `/system reset-configuration no-defaults=yes`. Sections:

- Identity, admin password, disable unused services
- Bridge `bridge-trunk` on `ether2` with `vlan-filtering=yes`
- VLAN interfaces `vlan10-server`, `vlan20-staff`, `vlan30-students` (tagged on ether2)
- `/interface bridge vlan` tagged/untagged matrix
- IP addresses `192.168.{10,20,30}.1/24`
- DHCP pools + servers + networks per VLAN (DNS = router IP)
- `/ip dns` with `allow-remote-requests=yes`, upstream `1.1.1.1, 9.9.9.9`
- WAN on `ether1` as DHCP client
- Firewall: stateful baseline (established/related/invalid), allow ICMP, allow LAN→WAN, allow inter-VLAN VLAN30↔VLAN10 server only, drop other inter-VLAN
- NAT masquerade on `ether1`
- Hotspot setup on `vlan30-students`:
  - `/ip hotspot profile` `students-hsprof` with `login-by=http-pap,mac`, `http-cookie-lifetime=0`, `mac-auth-password=""`, external `login-page` redirect via walled-garden trick (HTML `/login.html` that meta-refreshes to `http://192.168.10.2/api/captive?mac=$(mac)&ip=$(ip)&target=$(link-orig-esc)`)
  - `/ip hotspot user profile` `student-profile` (shared-users unlimited, address-list `students-ok`)
  - `/ip pool` `hs-pool-30`
  - `/ip hotspot` instance bound to `vlan30-students`
  - `/ip hotspot walled-garden ip` allow dst `192.168.10.2` tcp 80/443
  - `/ip hotspot walled-garden` allow DNS to router
- API service: `/ip service set api address=192.168.10.0/24 disabled=no`
- API user `portal-api` in a custom group with `api,read,write,policy,hotspot` rights, password from env
- Verification commands at the end

### 3. `docs/captive-portal/mikrotik/login.html`
The tiny HTML file uploaded to MikroTik's `/hotspot/login.html` that immediately redirects the client browser to the backend portal URL with `$(mac)`, `$(ip)`, `$(link-orig-esc)` substituted.

### 4. `docs/captive-portal/backend/` — Next.js 14 App Router project

File tree:

```text
backend/
  package.json
  tsconfig.json
  next.config.mjs
  tailwind.config.ts
  postcss.config.mjs
  .env.example
  prisma/
    schema.prisma
    seed.ts
  src/
    lib/
      db.ts                  # Prisma singleton
      mikrotik.ts            # routeros-client wrapper: addHotspotUser, removeHotspotUser, loginUser, disconnectUser, listActive
      mac.ts                 # normalize() -> AA:BB:CC:DD:EE:FF, validate
      auth.ts                # iron-session config, password hashing (argon2), admin user model
      rateLimit.ts           # in-memory token bucket for /api/login
      validators.ts          # zod schemas
    middleware.ts            # protect /admin/** and /api/admin/**
    app/
      layout.tsx
      globals.css
      page.tsx               # redirects to /admin
      api/
        captive/route.ts     # GET -> HTML form (mac/ip/target hidden)
        login/route.ts       # POST -> full student/MAC state machine
        denied/route.ts      # GET -> denied page
        admin/
          login/route.ts     # POST email+password -> session cookie
          logout/route.ts
          approve-student/route.ts
          deny-student/route.ts
          approve-device/route.ts
          reject-device/route.ts
          revoke/route.ts
          students/route.ts  # GET list + filter
      admin/
        login/page.tsx
        layout.tsx           # checks session, renders nav
        page.tsx             # dashboard: stats
        students/page.tsx    # table, filter by studentId, approve/deny/revoke buttons
        devices/page.tsx     # pending additional-device requests with reason + approve/reject
  scripts/
    create-admin.ts          # CLI: bun/node script to seed first admin (prompts for email/password)
  systemd/
    captive-portal.service   # runs `next start -p 80` as a non-root user with CAP_NET_BIND_SERVICE
  nginx/
    captive-portal.conf      # optional reverse-proxy + TLS termination (HTTP on :80 mandatory for portal)
```

**Auth choice (replacing HTTP Basic):** local admin accounts stored in the SQLite DB, passwords hashed with `argon2`, sessions via `iron-session` (encrypted httpOnly cookie, 8h sliding). First admin created via `scripts/create-admin.ts` on the server. No external auth provider, runs fully offline on the VLAN-10 box. Middleware enforces session on `/admin/**` and `/api/admin/**`.

**Login state machine (`POST /api/login`)** implements your spec exactly:
1. Validate input (`zod`), normalize MAC.
2. Look up `Student` by `studentId`.
3. Not found → create `Student{status:PENDING}` + `Device{approved:false}` → render "waiting for approval".
4. `DENIED` → 302 to `/api/denied`.
5. `ACTIVE`:
   - MAC already bound & approved → `mikrotik.loginUser(mac, ip)` → 302 to original target.
   - No device bound yet → create `Device{approved:true}`, `mikrotik.addHotspotUser(studentId, mac, 'student-profile')`, `mikrotik.loginUser(...)` → 302 to target.
   - Different MAC already bound → if `reason` not provided render reason form; else create `Device{approved:false, reason}` → "pending admin approval" page.
6. All MikroTik calls wrapped in try/catch with structured logging; DB transaction rolls back if router call fails on the binding path.

**Admin actions** call the same `mikrotik.ts` helpers; revoke iterates all devices for the student, deletes each hotspot user, and calls `disconnectUser(mac)` for any active session.

**MikroTik client:** `routeros-client` (actively maintained `node-routeros` fork). Wrapper owns connection pooling, reconnect on `ECONNRESET`, and exposes the four documented methods plus `listActiveByMac`.

### 5. `docs/captive-portal/DEPLOY.md`
Step-by-step for the Ubuntu/Debian box at 192.168.10.2:
- Static IP config (netplan snippet)
- Install Node 20 + bun (or npm), clone the `backend/` folder
- `cp .env.example .env`, fill `MIKROTIK_HOST=192.168.10.1`, API creds, `SESSION_SECRET` (openssl rand), `DATABASE_URL="file:./prod.db"`
- `bunx prisma migrate deploy && bunx prisma generate`
- `bun run scripts/create-admin.ts`
- Install `systemd/captive-portal.service`, `setcap 'cap_net_bind_service=+ep'` on node, `systemctl enable --now captive-portal`
- Verify: `curl http://192.168.10.2/api/captive?mac=AA:BB:CC:DD:EE:FF&ip=192.168.30.50&target=http://example.com`
- Walled-garden test from a VLAN 30 client before login

## Out of scope / explicit non-goals
- No code runs in the Lovable preview; this repo's TanStack app is untouched.
- HTTPS for the portal itself is intentionally HTTP (captive-portal detection requires it); admin UI can be fronted by nginx+TLS as documented.
- No multi-router / RADIUS support — single MikroTik via API only, as spec'd.

## Confirm before I build
This will add ~25 files under `docs/captive-portal/` and touch nothing else. Approve and I'll write the full bundle in one pass.
