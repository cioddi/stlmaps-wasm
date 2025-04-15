import React, { Suspense } from "react";
import { Box, CircularProgress, useTheme } from "@mui/material";
import ModelPreview from "./ModelPreview";

interface ModelSectionProps {
  flex: number;
  display: string;
}

const ModelSection: React.FC<ModelSectionProps> = ({ flex, display }) => {
  const theme = useTheme();

  return (
    <Box
      sx={{ 
        flex: flex, 
        position: "relative", 
        minHeight: 0, 
        zIndex: 10000, 
        display: display,
        transition: theme.transitions.create(['flex', 'display'], {
          duration: theme.transitions.duration.standard,
        })
      }}
    >
      <Suspense fallback={<CircularProgress />}>
        <ModelPreview />
      </Suspense>
    </Box>
  );
};

export default ModelSection;
