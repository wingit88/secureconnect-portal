# MikroTik Captive Portal + Self-Hosted Backend

End-to-end reference implementation of a school network with three VLANs and
a custom captive portal for students, backed by a Next.js admin app that
drives the MikroTik via its API.

> This bundle lives inside the Lovable repo as **documentation only**. None
> of it runs in the Lovable preview. Copy `docs/captive-portal/` onto your
> own infrastructure to deploy it.

## Topology

```
              Internet
                 │
              ether1  (DHCP client, NAT masquerade)
         ┌────MikroTik────┐
         │ ether2 (trunk) │  802.1Q tagged: 10, 20, 30
         └────────┬───────┘
                  │
         ┌────────┴──────────┐
         │   Managed switch  │
         └─┬───────┬───────┬─┘
        VLAN10  VLAN20  VLAN30
      Servers  Staff   Students (captive portal)

VLAN 10  192.168.10.0/24   gw .1   Backend server @ .2
VLAN 20  192.168.20.0/24   gw .1   No portal
VLAN 30  192.168.30.0/24   gw .1   Hotspot + external login page
```

## Deployment order

1. **Router first** — apply `mikrotik/setup.rsc`, upload `mikrotik/login.html`.
   Confirm a VLAN-30 client gets DHCP and is redirected on first HTTP.
2. **Backend box second** — static IP `192.168.10.2/24` gw `192.168.10.1`,
   then follow `DEPLOY.md` to install the Next.js app and create the first
   admin user.
3. **Walled garden test** — from a fresh VLAN-30 device, `curl
   http://192.168.10.2/api/captive` must succeed *before* login.
4. **End-to-end test** — open `http://neverssl.com` on the student device;
   the hotspot must redirect to the portal; submit a Student ID; admin
   approves; device reloads and reaches the internet without re-prompting.

## Troubleshooting

- **Portal never appears.** Some OSes only probe HTTPS; the hotspot only
  intercepts HTTP. Use `http://neverssl.com` for tests.
- **Portal loads but `/api/login` 502s.** Backend box isn't reachable from
  VLAN 30. Check firewall rule `forward: vlan30 -> 192.168.10.2 accept`.
- **IP binding added but device still sees portal.** Confirm the binding is
  `type=bypassed` and the hotspot host entry was removed (the backend does
  this automatically on approve). The client may need to reload the page or
  wait a few seconds for the hotspot to re-evaluate.
- **MAC formatting drift.** All code paths funnel through
  `src/lib/mac.ts::normalize()` — uppercase, colon-separated. Never store raw.
- **Router API refuses connection.** `/ip service print` — confirm `api`
  is enabled, address-list includes `192.168.10.0/24`.

See `mikrotik/setup.rsc`, `backend/`, and `DEPLOY.md`.