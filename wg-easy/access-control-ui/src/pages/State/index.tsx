/* oxlint-disable react/jsx-no-literals */

import { Box, Paper, Stack, Typography } from "@mui/material";
import { HvTypography } from "@hitachivantara/uikit-react-core";

import { useAccessControlState } from "../../lib/useAccessControlState";

export function Component() {
  const { state, loading, error, lastUpdated } = useAccessControlState();

  return (
    <Stack spacing={2}>
      <HvTypography variant="title1">Raw state</HvTypography>
      <Typography color="text.secondary">
        Machine-readable snapshot returned by the access-control API.
      </Typography>

      {(loading || error || lastUpdated) && (
        <Paper elevation={0} sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
          <Stack spacing={1}>
            {loading && <Typography>Loading...</Typography>}
            {error && <Typography color="error">{error}</Typography>}
            {lastUpdated && <Typography>Last updated: {lastUpdated}</Typography>}
          </Stack>
        </Paper>
      )}

      <Paper
        elevation={0}
        sx={{
          p: 2,
          border: "1px solid",
          borderColor: "divider",
          overflowX: "auto",
        }}
      >
        <Box
          component="pre"
          sx={{ m: 0, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}
        >
          {state ? JSON.stringify(state, null, 2) : "No state loaded yet."}
        </Box>
      </Paper>
    </Stack>
  );
}
