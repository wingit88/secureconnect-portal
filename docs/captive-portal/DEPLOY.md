# Deployment — Backend Server (VLAN 10, 192.168.10.2)

Assumes Ubuntu Server 22.04+ on a small box wired to a port that the managed
switch presents as **untagged VLAN 10** (or to a NIC that itself does the
VLAN-10 tag).

## 1. Static IP

`/etc/netplan/00-portal.yaml`:

```yaml
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: false
      addresses: [192.168.10.2/24]
      routes:
        - to: default
          via: 192.168.10.1
      nameservers:
        addresses: [192.168.10.1, 1.1.1.1]
```

```
sudo netplan apply
ping -c2 192.168.10.1
```

## 2. Install Node 20 + dependencies

```
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
sudo useradd --system --create-home --shell /usr/sbin/nologin portal
sudo mkdir -p /opt/captive-portal && sudo chown portal:portal /opt/captive-portal
```

Copy the contents of `docs/captive-portal/backend/` from this repo into
`/opt/captive-portal/` (rsync, scp, or `git clone`).

```
# IMPORTANT: copied files must be writable by the portal user so SQLite can
# create /opt/captive-portal/prisma/prod.db.
sudo chown -R portal:portal /opt/captive-portal

# IMPORTANT: install devDependencies too (prisma CLI, tsx, tailwind, typescript)
sudo -u portal bash -lc 'cd /opt/captive-portal && NODE_ENV=development npm ci --include=dev'
sudo -u portal cp /opt/captive-portal/.env.example /opt/captive-portal/.env
sudo -u portal nano /opt/captive-portal/.env   # fill secrets
```

Generate `SESSION_SECRET`:

```
openssl rand -base64 48
```

## 3. Database + first admin

```
cd /opt/captive-portal
# If you copied files as ubuntu/root after install, fix ownership again before
# migrating; SQLite needs write access to the prisma/ directory.
sudo chown -R portal:portal /opt/captive-portal

# Use the LOCAL Prisma 5 binary (not `npx prisma`, which may fetch Prisma 7
# from the internet and fail with "datasource url is no longer supported").
sudo -u portal ./node_modules/.bin/prisma migrate deploy
sudo -u portal ./node_modules/.bin/prisma generate
sudo -u portal npm run create-admin   # interactive prompts
```

After the reliability hardening update, migrations now also create `RouterSyncJob`
and device sync-state columns. `prisma migrate deploy` must run before restarting
the service.

If you see `unable to open database file: ./prod.db`, ownership is still wrong
or the `prisma/` directory is missing:

```
sudo install -d -o portal -g portal /opt/captive-portal/prisma
sudo chown -R portal:portal /opt/captive-portal
sudo -u portal ./node_modules/.bin/prisma migrate deploy
```

If you see `You defined the enum StudentStatus`, the server still has an older
`prisma/schema.prisma`. Re-copy the updated backend files from this repo; the
current SQLite schema stores `Student.status` as a string, not a Prisma enum.

## 4. Build and bind to port 80

```
sudo -u portal npm run build
# allow non-root node to bind :80
sudo setcap 'cap_net_bind_service=+ep' "$(readlink -f "$(which node)")"
```

## 5. Systemd service

```
sudo cp /opt/captive-portal/systemd/captive-portal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now captive-portal
sudo journalctl -u captive-portal -f
```

When redeploying an existing server:
```
cd /opt/captive-portal
sudo chown -R portal:portal /opt/captive-portal
sudo -u portal bash -lc 'cd /opt/captive-portal && NODE_ENV=development npm ci --include=dev'
sudo -u portal ./node_modules/.bin/prisma migrate deploy
sudo -u portal ./node_modules/.bin/prisma generate
sudo -u portal npm run build
sudo systemctl restart captive-portal
```

## 6. Smoke tests

From the server itself:
```
curl -i http://127.0.0.1/api/captive
curl -i http://127.0.0.1/api/denied
```

From a VLAN-30 client (before any login):
```
curl -i http://192.168.10.2/api/captive
```
Must return the HTML form (walled garden working).

Then open `http://neverssl.com` in a browser on that device — the hotspot
should redirect to the portal. Submit a fake Student ID; admin signs in at
`http://192.168.10.2/admin/login` and processes the pending registration.

Run reliability smoke checks from the server:
```
cd /opt/captive-portal
sudo -u portal PORTAL_BASE_URL=http://127.0.0.1 npm run smoke:reliability
```

## 7. Optional: nginx in front

If you want TLS on the admin pages, install nginx and use
`backend/nginx/captive-portal.conf` as a starting point. The captive portal
routes themselves must remain reachable over plain HTTP.

## 8. Backups

SQLite file lives at `/opt/captive-portal/prisma/prod.db`. Snapshot nightly:

```
sudo -u portal sqlite3 /opt/captive-portal/prisma/prod.db ".backup '/var/backups/portal-$(date +%F).db'"
```