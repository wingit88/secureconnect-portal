# =========================================================================
# MikroTik captive-portal setup script
# Paste into a fresh router via WinBox terminal or:
#   /import file-name=setup.rsc
# Starts from a hard reset. Replace REPLACE_ME_* values before running.
# =========================================================================

# ---- 0. Factory reset (skip this line if already reset; it reboots) -----
# /system reset-configuration no-defaults=yes skip-backup=yes

# ---- 1. Identity & admin password ---------------------------------------
/system identity set name=school-edge
/user set admin password=REPLACE_ME_ADMIN_PASS

# ---- 2. Disable unused services -----------------------------------------
/ip service disable telnet,ftp,www-ssl,api-ssl
/ip service set winbox address=192.168.10.0/24
/ip service set ssh   address=192.168.10.0/24

# ---- 3. WAN: ether1 = DHCP client, NAT masquerade -----------------------
/ip dhcp-client add interface=ether1 disabled=no comment="WAN uplink"
/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade \
    comment="NAT to internet"

# ---- 4. Bridge with VLAN filtering; one access port per VLAN ------------
# ether2 = VLAN 10 (server), ether3 = VLAN 20 (staff), ether4 = VLAN 30 (students).
# Each downstream port is an untagged access port; the host device must NOT
# tag frames. vlan-filtering is enabled at the end of the script.
/interface bridge add name=bridge-trunk vlan-filtering=no \
    comment="enable vlan-filtering at end"
/interface bridge port add bridge=bridge-trunk interface=ether2 \
    pvid=10 frame-types=admit-only-untagged-and-priority-tagged \
    comment="access port: VLAN 10 (server)"
/interface bridge port add bridge=bridge-trunk interface=ether3 \
    pvid=20 frame-types=admit-only-untagged-and-priority-tagged \
    comment="access port: VLAN 20 (staff)"
/interface bridge port add bridge=bridge-trunk interface=ether4 \
    pvid=30 frame-types=admit-only-untagged-and-priority-tagged \
    comment="access port: VLAN 30 (students)"

# ---- 5. VLAN interfaces on the bridge -----------------------------------
/interface vlan add name=vlan10-server   vlan-id=10 interface=bridge-trunk
/interface vlan add name=vlan20-staff    vlan-id=20 interface=bridge-trunk
/interface vlan add name=vlan30-students vlan-id=30 interface=bridge-trunk

# ---- 6. Bridge VLAN table -----------------------------------------------
# Router CPU (bridge-trunk) is tagged so the vlanN interfaces work.
# Each physical port is untagged in exactly one VLAN.
/interface bridge vlan add bridge=bridge-trunk vlan-ids=10 \
    tagged=bridge-trunk untagged=ether2
/interface bridge vlan add bridge=bridge-trunk vlan-ids=20 \
    tagged=bridge-trunk untagged=ether3
/interface bridge vlan add bridge=bridge-trunk vlan-ids=30 \
    tagged=bridge-trunk untagged=ether4

# ---- 7. IP addresses (router-on-a-stick gateways) -----------------------
/ip address add address=192.168.10.1/24 interface=vlan10-server
/ip address add address=192.168.20.1/24 interface=vlan20-staff
/ip address add address=192.168.30.1/24 interface=vlan30-students

# ---- 8. DHCP pools and servers ------------------------------------------
/ip pool add name=pool-vlan10 ranges=192.168.10.100-192.168.10.200
/ip pool add name=pool-vlan20 ranges=192.168.20.100-192.168.20.200
/ip pool add name=pool-vlan30 ranges=192.168.30.100-192.168.30.250

/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 dns-server=192.168.10.1
/ip dhcp-server network add address=192.168.20.0/24 gateway=192.168.20.1 dns-server=192.168.20.1
/ip dhcp-server network add address=192.168.30.0/24 gateway=192.168.30.1 dns-server=192.168.30.1

/ip dhcp-server add name=dhcp10 interface=vlan10-server   address-pool=pool-vlan10 disabled=no
/ip dhcp-server add name=dhcp20 interface=vlan20-staff    address-pool=pool-vlan20 disabled=no
/ip dhcp-server add name=dhcp30 interface=vlan30-students address-pool=pool-vlan30 disabled=no

# ---- 9. DNS -------------------------------------------------------------
/ip dns set allow-remote-requests=yes servers=1.1.1.1,9.9.9.9

# ---- 10. Firewall: stateful baseline ------------------------------------
/ip firewall filter
add chain=input  action=accept connection-state=established,related comment="established/related"
add chain=input  action=drop   connection-state=invalid              comment="drop invalid"
add chain=input  action=accept protocol=icmp                         comment="allow ICMP"
add chain=input  action=accept in-interface=vlan10-server            comment="trust server VLAN"
add chain=input  action=accept in-interface=vlan20-staff dst-port=53 protocol=udp
add chain=input  action=accept in-interface=vlan30-students dst-port=53 protocol=udp
add chain=input  action=accept in-interface=vlan20-staff dst-port=53 protocol=tcp
add chain=input  action=accept in-interface=vlan30-students dst-port=53 protocol=tcp
add chain=input  action=drop   in-interface=!ether1 log=no           comment="drop other LAN to router"
add chain=input  action=drop   in-interface=ether1                    comment="drop WAN to router"

add chain=forward action=accept connection-state=established,related
add chain=forward action=drop   connection-state=invalid
# allow all LAN-to-WAN
add chain=forward action=accept in-interface=vlan10-server   out-interface=ether1
add chain=forward action=accept in-interface=vlan20-staff    out-interface=ether1
add chain=forward action=accept in-interface=vlan30-students out-interface=ether1
# inter-VLAN: VLAN30 may only reach the backend server, not the rest of VLAN10
add chain=forward action=accept in-interface=vlan30-students out-interface=vlan10-server \
    dst-address=192.168.10.2 comment="students -> portal server"
add chain=forward action=accept in-interface=vlan10-server   out-interface=vlan30-students \
    src-address=192.168.10.2 comment="portal server -> students"
# staff <-> server full (optional)
add chain=forward action=accept in-interface=vlan20-staff    out-interface=vlan10-server
add chain=forward action=accept in-interface=vlan10-server   out-interface=vlan20-staff
# drop everything else between LAN segments
add chain=forward action=drop   in-interface=vlan30-students out-interface=vlan10-server
add chain=forward action=drop   in-interface=vlan30-students out-interface=vlan20-staff
add chain=forward action=drop   in-interface=vlan20-staff    out-interface=vlan30-students

# ---- 11. Enable bridge VLAN filtering NOW (after addresses set) ---------
/interface bridge set bridge-trunk vlan-filtering=yes

# ---- 12. Hotspot for VLAN 30 --------------------------------------------
/ip pool add name=hs-pool-30 ranges=192.168.30.100-192.168.30.250

/ip hotspot profile add name=students-hsprof hotspot-address=192.168.30.1 \
    dns-name=hotspot.school.lan login-by=http-pap,mac mac-auth-password="" \
    http-cookie-lifetime=0 use-radius=no

/ip hotspot user profile add name=student-profile shared-users=unlimited \
    address-list=students-ok

/ip hotspot add name=hs-vlan30 interface=vlan30-students \
    address-pool=hs-pool-30 profile=students-hsprof disabled=no

# Walled garden: allow the backend portal server (HTTP + HTTPS) and DNS
/ip hotspot walled-garden ip add dst-address=192.168.10.2 protocol=tcp dst-port=80  action=accept
/ip hotspot walled-garden ip add dst-address=192.168.10.2 protocol=tcp dst-port=443 action=accept
/ip hotspot walled-garden ip add dst-address=192.168.30.1 protocol=udp dst-port=53  action=accept
/ip hotspot walled-garden ip add dst-address=192.168.30.1 protocol=tcp dst-port=53  action=accept

# ---- 13. RouterOS API (restricted to VLAN 10) ---------------------------
/ip service set api address=192.168.10.0/24 disabled=no port=8728

/user group add name=portal-api policy=api,read,write,policy,test,sensitive
/user add name=portal-api group=portal-api password=REPLACE_ME_API_PASS \
    address=192.168.10.0/24 comment="captive portal backend"

# ---- 14. Verification ---------------------------------------------------
# /interface vlan print
# /ip address print
# /ip dhcp-server print
# /ip hotspot print
# /ip hotspot walled-garden ip print
# /ip service print
#
# From a VLAN-30 client BEFORE login:
#   curl -v http://192.168.10.2/api/captive
# Must return HTML (200), not be intercepted by the hotspot.
#
# Then from any browser on VLAN 30:
#   http://neverssl.com   ->  must redirect to the portal page
# =========================================================================