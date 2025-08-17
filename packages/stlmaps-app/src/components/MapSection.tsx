import React from "react";
import { Box } from "@mui/material";
import { MapLibreMap } from "@mapcomponents/react-maplibre";
import BboxToCenterButton from "./BboxToCenterButton";

interface MapSectionProps {
  mapCenter: [number, number];
  flex: number;
  display: string;
  bboxSelectorRef?: React.RefObject<{ updateBbox: () => void }>;
}

const MapSection: React.FC<MapSectionProps> = React.memo(({
  mapCenter,
  flex,
  display,
  bboxSelectorRef,
}) => {
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
          style: {
            version: 8,
            sources: {
              openmaptiles: {
                type: "vector",
                url: "https://wms.wheregroup.com/tileserver/tile/world-0-14.json",
              },
            },
            layers: [
              {
                id: "background",
                type: "background",
                paint: {
                  "background-color": "#f8f8f8",
                },
              },
            ],

            sprite: "https://wms.wheregroup.com/tileserver/sprites/osm-bright",
            glyphs:
              "https://wms.wheregroup.com/tileserver/fonts/{fontstack}/{range}.pbf",
          },
        }}
      />


      {/* Add BBOX to Center button */}
      {bboxSelectorRef && (
        <BboxToCenterButton bboxSelectorRef={bboxSelectorRef} />
      )}
    </Box>
  );
});

export default MapSection;
