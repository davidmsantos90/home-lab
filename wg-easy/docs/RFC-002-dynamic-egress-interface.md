# RFC-002 --- Dynamic Egress Interface Detection

## Status

**Proposed**

## Background

`wg-easy` generates:

``` bash
iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o eth0 -j MASQUERADE
```

This incorrectly assumes the Internet-facing interface is always `eth0`.

When the container is attached to multiple Docker networks, the default
route may instead be:

``` text
default via 192.168.100.1 dev eth1
```

Result:

-   Handshake succeeds.
-   Traffic reaches the server.
-   VPN clients cannot access the Internet because packets are not NATed
    on the actual egress interface.

## Root Cause

The MASQUERADE rule is bound to a fixed interface instead of the
interface used by the default route.

## Desired Behaviour

Determine the outbound interface dynamically:

``` bash
DEFAULT_IF=$(ip route show default | awk '{print $5}' | head -n1)

iptables -t nat -A POSTROUTING     -s 10.8.0.0/24     -o "$DEFAULT_IF"     -j MASQUERADE
```

This removes any dependency on Docker interface ordering.

## Validation

Check:

``` bash
docker exec wg-easy ip route
docker exec wg-easy iptables -t nat -S
```

The interface used by the MASQUERADE rule must match the interface from
the default route.

Finally:

``` bash
curl https://ifconfig.me
```

should succeed from a connected VPN client.

## Why This Matters

Docker does not guarantee interface numbering when a container belongs
to multiple networks. Discovering the egress interface dynamically makes
the deployment portable and robust.

## Troubleshooting

Symptoms:

-   Handshake succeeds.
-   RX/TX counters increase.
-   No Internet access through the VPN.

Compare:

``` bash
docker exec wg-easy ip route
docker exec wg-easy iptables -t nat -S
```

If the default route uses `eth1` but the MASQUERADE rule targets `eth0`,
outbound VPN traffic will fail until the NAT rule is updated.
