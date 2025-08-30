import React, { Suspense } from "react";
import { Box, CircularProgress } from "@mui/material";
import ModelPreview from "./ModelPreview";

interface ModelSectionProps {
  flex: number;
  display: string;
}

const ModelSection: React.FC<ModelSectionProps> = ({ flex, display }) => {

  return (
    <Box
      sx={{ 
        flex: flex, 
        position: "relative", 
        minHeight: 0, 
        zIndex: 10000, 
        display: display,
      }}
    >
      <Suspense fallback={<CircularProgress />}>
        <ModelPreview />
      </Suspense>
    </Box>
  );
};

export default ModelSection;
