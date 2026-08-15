/* oxlint-disable react/jsx-no-literals */

import { useNavigate } from "react-router-dom";
import { Box, Paper, Stack, Typography } from "@mui/material";
import { HvButton, HvTypography, theme } from "@hitachivantara/uikit-react-core";

export const Component = () => {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        minHeight: `calc(100vh - ${theme.header.height})`,
        display: "grid",
        placeItems: "center",
        px: 3,
      }}
    >
      <Paper elevation={0} sx={{ maxWidth: 560, width: "100%", p: 4 }}>
        <Stack spacing={2}>
          <HvTypography variant="title1">Page not found</HvTypography>
          <Typography>
            The requested access-control page does not exist.
          </Typography>
          <div>
            <HvButton variant="primaryGhost" onClick={() => navigate("/")}>
              Back to dashboard
            </HvButton>
          </div>
        </Stack>
      </Paper>
    </Box>
  );
};
