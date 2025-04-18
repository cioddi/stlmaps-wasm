import React from "react";
import { Box, useTheme } from "@mui/material";
import { MapLibreMap } from "@mapcomponents/react-maplibre";
import BboxToCenterButton from "./BboxToCenterButton";

interface MapSectionProps {
  mapCenter: [number, number];
  flex: number;
  display: string;
  bboxSelectorRef?: React.RefObject<{ updateBbox: () => void }>;
}

const MapSection: React.FC<MapSectionProps> = ({ mapCenter, flex, display, bboxSelectorRef }) => {
  const theme = useTheme();

  return (
    <Box 
      sx={{ 
        flex: flex, 
        position: "relative", 
        minHeight: 0, 
        display: display, 
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
          
          zoom: 15,
          style: "https://wms.wheregroup.com/tileserver/style/osm-bright.json",
        }}
      />
      {/* Add BBOX to Center button */}
      {bboxSelectorRef && (
        <BboxToCenterButton bboxSelectorRef={bboxSelectorRef} />
      )}
    </Box>
  );
};

export default MapSection;
