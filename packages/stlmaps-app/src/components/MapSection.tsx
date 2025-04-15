import React from "react";
import { Box, useTheme } from "@mui/material";
import { MapLibreMap } from "@mapcomponents/react-maplibre";

interface MapSectionProps {
  mapCenter: [number, number];
  flex: number;
  display: string;
}

const MapSection: React.FC<MapSectionProps> = ({ mapCenter, flex, display }) => {
  const theme = useTheme();

  return (
    <Box 
      sx={{ 
        flex: flex, 
        position: "relative", 
        minHeight: 0, 
        display: display, 
        transition: theme.transitions.create(['flex', 'display'], {
          duration: theme.transitions.duration.standard,
        })
      }}
    >
      <MapLibreMap
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
        }}
        options={{
          center: mapCenter,
          zoom: 14,
          style: "https://wms.wheregroup.com/tileserver/style/osm-bright.json",
        }}
      />
    </Box>
  );
};

export default MapSection;
