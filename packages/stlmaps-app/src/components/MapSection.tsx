import React from "react";
import { Box } from "@mui/material";
import { MapLibreMap, useMap } from "@mapcomponents/react-maplibre";
import BboxToCenterButton from "./BboxToCenterButton";
import { useEffect } from "react";

interface MapSectionProps {
  mapCenter: [number, number];
  flex: number;
  display: string;
  bboxSelectorRef?: React.RefObject<{ updateBbox: () => void } | null>;
  initialBounds?: [number, number, number, number];
}

const MapCenterUpdater: React.FC<{ mapCenter: [number, number] }> = ({ mapCenter }) => {
  const { map } = useMap();

  useEffect(() => {
    if (map) {
      map.flyTo({ center: mapCenter });
    }
  }, [map, mapCenter]);

  return null;
};

const MapBoundsFitter: React.FC<{ bounds: [number, number, number, number] }> = ({ bounds }) => {
  const { map } = useMap();
  const fittedRef = React.useRef(false);

  useEffect(() => {
    if (map && bounds && !fittedRef.current) {
      map.fitBounds(bounds, { padding: 50 });
      fittedRef.current = true;
    }
  }, [map, bounds]);

  return null;
};

const MapSection: React.FC<MapSectionProps> = React.memo(({
  mapCenter,
  flex,
  display,
  bboxSelectorRef,
  initialBounds,
}) => {
  const mapOptions = React.useMemo(() => ({
    center: mapCenter,
    zoom: 15,
    attributionControl: {
      customAttribution: ['MapLibre', 'MapComponents', 'OpenMapTiles', 'OpenStreetMap']
    },
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
  }), []);

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
        options={mapOptions}
      />
      <MapCenterUpdater mapCenter={mapCenter} />
      {initialBounds && <MapBoundsFitter bounds={initialBounds} />}


      {/* Add BBOX to Center button */}
      {bboxSelectorRef && (
        <BboxToCenterButton bboxSelectorRef={bboxSelectorRef} />
      )}
    </Box>
  );
});

export default MapSection;
