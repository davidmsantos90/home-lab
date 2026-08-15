/* oxlint-disable react/jsx-no-literals */

import { useMemo } from "react";

import {
  HvButton,
  HvLoading,
  HvTypography,
} from "@hitachivantara/uikit-react-core";
import {
  Alert,
  Box,
  Chip,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

import { useAccessControlState } from "../../lib/useAccessControlState";
import type { AccessControlRule } from "../../lib/access-control-api";

function formatSelector(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "—";
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return "—";
}

function formatService(rule: AccessControlRule) {
  if (rule.service) {
    return formatSelector(rule.service);
  }
  const protocol = rule.protocol ?? "any";
  const port = rule.port ?? "any";
  return `${protocol}/${port}`;
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string | number;
  helper?: string;
}) {
  return (
    <Paper elevation={0} sx={{ p: 2.5, border: "1px solid", borderColor: "divider" }}>
      <Stack spacing={0.5}>
        <Typography variant="overline" color="text.secondary">
          {label}
        </Typography>
        <HvTypography variant="title1">{value}</HvTypography>
        {helper && (
          <Typography variant="body2" color="text.secondary">
            {helper}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

export function Component() {
  const { apiUrl, state, loading, refreshing, error, lastUpdated, reload } =
    useAccessControlState();

  const summary = useMemo(() => {
    if (!state) {
      return null;
    }
    const aliases = state.aliases;
    const serviceEntries = Object.values(aliases.services).reduce(
      (count, entries) => count + entries.length,
      0,
    );

    return {
      peers: state.peers.length,
      rules: state.rules.length,
      ipsets: state.compiled.ipsets.length,
      groups: Object.keys(aliases.groups).length,
      hosts: Object.keys(aliases.hosts).length,
      services: Object.keys(aliases.services).length,
      serviceEntries,
      compiledRules: state.compiled.iptables.length,
    };
  }, [state]);

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        alignItems={{ xs: "flex-start", md: "center" }}
        justifyContent="space-between"
      >
        <Box>
          <HvTypography variant="title1">wg-easy Access Control</HvTypography>
          <Typography color="text.secondary">
            React + UI Kit dashboard for live peer discovery, alias catalogs,
            policy rules, and compiled firewall previews.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} flexWrap="wrap">
          <HvButton variant="primaryGhost" onClick={reload}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </HvButton>
          <HvButton
            variant="primaryGhost"
            onClick={async () => {
              await navigator.clipboard.writeText(apiUrl);
            }}
          >
            Copy API URL
          </HvButton>
        </Stack>
      </Stack>

      <Paper elevation={0} sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", md: "center" }}
        >
          <Box>
            <Typography variant="overline" color="text.secondary">
              API endpoint
            </Typography>
            <HvTypography>{apiUrl}</HvTypography>
          </Box>
          <Box>
            <Typography variant="overline" color="text.secondary">
              Last updated
            </Typography>
            <HvTypography>{lastUpdated ?? "—"}</HvTypography>
          </Box>
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}

      {loading && !state ? (
        <Paper elevation={0} sx={{ p: 4 }}>
          <HvLoading label="Loading access-control state" />
        </Paper>
      ) : (
        <>
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0, 1fr))",
                lg: "repeat(4, minmax(0, 1fr))",
              },
            }}
          >
            <Box>
              <StatCard label="Backend" value={state?.backend ?? "—"} helper="iptables or ipset" />
            </Box>
            <Box>
              <StatCard label="Peers" value={summary?.peers ?? 0} helper="Live wg-easy inventory" />
            </Box>
            <Box>
              <StatCard label="Rules" value={summary?.rules ?? 0} helper="Logical policy rows" />
            </Box>
            <Box>
              <StatCard
                label="Compiled rules"
                value={summary?.compiledRules ?? 0}
                helper="iptables statements"
              />
            </Box>
          </Box>

          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                xs: "1fr",
                lg: "minmax(0, 1.4fr) minmax(0, 1fr)",
              },
            }}
          >
            <Box>
              <Paper elevation={0} sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
                <Stack spacing={2}>
                  <Box>
                    <HvTypography variant="title3">Live peers</HvTypography>
                    <Typography variant="body2" color="text.secondary">
                      Names come from wg-easy; the UI refreshes automatically every
                      30 seconds.
                    </Typography>
                  </Box>
                  <TableContainer component={Box} sx={{ overflowX: "auto" }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>IPv4</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(state?.peers ?? []).map((peer) => (
                          <TableRow key={peer.name} hover>
                            <TableCell>{peer.name}</TableCell>
                            <TableCell>{peer.ipv4Address}</TableCell>
                          </TableRow>
                        ))}
                        {(state?.peers ?? []).length === 0 && (
                          <TableRow>
                            <TableCell colSpan={2}>No peers found.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Stack>
              </Paper>
            </Box>

            <Box>
              <Paper elevation={0} sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
                <Stack spacing={2}>
                  <Box>
                    <HvTypography variant="title3">Alias catalog</HvTypography>
                    <Typography variant="body2" color="text.secondary">
                      Named groups, hosts, and services used by the policy model.
                    </Typography>
                  </Box>

                  <Stack spacing={1}>
                    <Typography variant="overline" color="text.secondary">
                      Groups ({summary?.groups ?? 0})
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {Object.keys(state?.aliases.groups ?? {}).map((group) => (
                        <Chip key={group} label={group} size="small" />
                      ))}
                    </Stack>
                  </Stack>

                  <Divider />

                  <Stack spacing={1}>
                    <Typography variant="overline" color="text.secondary">
                      Hosts ({summary?.hosts ?? 0})
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {Object.entries(state?.aliases.hosts ?? {}).map(([host, addresses]) => (
                        <Chip key={host} label={`${host} → ${addresses.join(", ")}`} size="small" />
                      ))}
                    </Stack>
                  </Stack>

                  <Divider />

                  <Stack spacing={1}>
                    <Typography variant="overline" color="text.secondary">
                      Services ({summary?.services ?? 0}, {summary?.serviceEntries ?? 0} entries)
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {Object.entries(state?.aliases.services ?? {}).map(([service, entries]) => (
                        <Chip
                          key={service}
                          label={`${service} (${entries.length})`}
                          size="small"
                        />
                      ))}
                    </Stack>
                  </Stack>
                </Stack>
              </Paper>
            </Box>
          </Box>

          <Paper elevation={0} sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
            <Stack spacing={2}>
              <Box>
                <HvTypography variant="title3">Policy rules</HvTypography>
                <Typography variant="body2" color="text.secondary">
                  The compiler evaluates these logical rules into deterministic
                  firewall state.
                </Typography>
              </Box>
              <TableContainer component={Box} sx={{ overflowX: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Source</TableCell>
                      <TableCell>Destination</TableCell>
                      <TableCell>Service</TableCell>
                      <TableCell>Action</TableCell>
                      <TableCell>Comment</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(state?.rules ?? []).map((rule) => (
                      <TableRow
                        key={[
                          formatSelector(rule.source ?? rule.source_group),
                          formatSelector(rule.destination ?? rule.destination_group),
                          formatService(rule),
                          rule.action,
                          rule.comment ?? "",
                        ].join("|")}
                        hover
                      >
                        <TableCell>{formatSelector(rule.source ?? rule.source_group)}</TableCell>
                        <TableCell>
                          {formatSelector(rule.destination ?? rule.destination_group)}
                        </TableCell>
                        <TableCell>{formatService(rule)}</TableCell>
                        <TableCell>
                          <Chip label={rule.action.toUpperCase()} size="small" />
                        </TableCell>
                        <TableCell>{rule.comment ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                    {(state?.rules ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5}>No rules found.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
            <Stack spacing={2}>
              <Box>
                <HvTypography variant="title3">Compiled preview</HvTypography>
                <Typography variant="body2" color="text.secondary">
                  These are the generated iptables statements and selector sets
                  the compiler will apply.
                </Typography>
              </Box>

              <Box>
                <Typography variant="overline" color="text.secondary">
                  ipsets
                </Typography>
                <Stack spacing={1} sx={{ mt: 1 }}>
                  {(state?.compiled.ipsets ?? []).map((entry) => (
                    <Paper
                      key={entry.name}
                      variant="outlined"
                      sx={{ p: 1.5, backgroundColor: "action.hover" }}
                    >
                      <Typography variant="body2">
                        <strong>{entry.name}</strong> → {entry.members.join(", ")}
                      </Typography>
                    </Paper>
                  ))}
                  {(state?.compiled.ipsets ?? []).length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No ipsets required for the current policy.
                    </Typography>
                  )}
                </Stack>
              </Box>

              <Divider />

              <Box>
                <Typography variant="overline" color="text.secondary">
                  iptables preview
                </Typography>
                <Paper
                  variant="outlined"
                  sx={{
                    mt: 1,
                    p: 2,
                    backgroundColor: "grey.50",
                    overflowX: "auto",
                    maxHeight: 420,
                  }}
                >
                  <Box component="pre" sx={{ m: 0, fontSize: 12, lineHeight: 1.6 }}>
                    {(state?.compiled.iptables ?? [])
                      .map((command) => command.join(" "))
                      .join("\n")}
                  </Box>
                </Paper>
              </Box>
            </Stack>
          </Paper>
        </>
      )}
    </Stack>
  );
}
