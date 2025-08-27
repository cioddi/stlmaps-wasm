import React, { useMemo } from "react";
import { MlVectorTileLayer } from "@mapcomponents/react-maplibre";
import useLayerStore from "../stores/useLayerStore";

interface DynamicVectorLayersProps {
  mapId?: string;
}

const DynamicVectorLayers: React.FC<DynamicVectorLayersProps> = React.memo(() => {
    const vtLayers = useLayerStore((state) => state.vtLayers);
    const terrainSettings = useLayerStore((state) => state.terrainSettings);

    // Create a stable dependency array
    const layerDeps = useMemo(
      () =>
        vtLayers.map((layer) => ({
          sourceLayer: layer.sourceLayer,
          enabled: layer.enabled,
          colorHex: layer.color?.getHexString(),
          filter: JSON.stringify(layer.filter), // Stringify filter for stable comparison
        })),
      [vtLayers]
    );

    // Generate layers configuration for MlVectorTileLayer
    const vectorTileLayers = useMemo(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const layers: any[] = [];

      // Add terrain background layer if terrain is enabled
      if (terrainSettings.enabled && terrainSettings.color) {
        layers.push({
          id: "terrain-background",
          type: "background",
          layout: {
            visibility: "visible",
          },
          paint: {
            "background-color": terrainSettings.color,
          },
        });
      }

      for (const layerDep of layerDeps) {
        // Use cached hex color from layerDeps
        const hexColor = layerDep.colorHex
          ? `#${layerDep.colorHex}`
          : "#ff0000";
        const filter = layerDep.filter
          ? JSON.parse(layerDep.filter)
          : undefined;

        // Set visibility based on enabled state
        const visibility = layerDep.enabled ? "visible" : "none";

        // Create layer configuration based on source layer type
        if (layerDep.sourceLayer === "transportation") {
          // Style roads
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const layer: any = {
            id: `${layerDep.sourceLayer}-line`,
            type: "line",
            "source-layer": layerDep.sourceLayer,
            layout: {
              visibility: visibility,
            },
            paint: {
              "line-color": hexColor,
              "line-width": 2,
            },
            maxzoom: 20,
          };
          if (filter) {
            layer.filter = filter;
          }
          layers.push(layer);
        } else if (layerDep.sourceLayer === "building") {
          // Style buildings
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const layer: any = {
            id: `${layerDep.sourceLayer}-fill`,
            type: "fill",
            "source-layer": layerDep.sourceLayer,
            layout: {
              visibility: visibility,
            },
            paint: {
              "fill-color": hexColor,
              "fill-opacity": 1.0, // Full opacity
              "fill-outline-color": "#232323",
            },
            minzoom: 5, // Lower minzoom to show at all zoom levels
            maxzoom: 20,
          };
          if (filter) {
            layer.filter = filter;
          }
          layers.push(layer);
        } else {
          // Style other layers (water, landuse, etc.)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const layer: any = {
            id: `${layerDep.sourceLayer}-fill`,
            type: "fill",
            "source-layer": layerDep.sourceLayer,
            layout: {
              visibility: visibility,
            },
            paint: {
              "fill-color": hexColor,
            },
            maxzoom: 20,
          };
          if (filter) {
            layer.filter = filter;
          }
          layers.push(layer);
        }
      }

      return layers;
    }, [layerDeps, terrainSettings.enabled, terrainSettings.color]);

    return (
      <MlVectorTileLayer
        insertBeforeLayer="data-order-layer"
        url="https://wms.wheregroup.com/tileserver/tile/tileserver.php?/europe-0-14/index.json?/europe-0-14/{z}/{x}/{y}.pbf"
        layers={vectorTileLayers || []}
        sourceOptions={{
          type: "vector",
          minzoom: 0,
          maxzoom: 14,
        }}
      />
    );
});

export default DynamicVectorLayers;
