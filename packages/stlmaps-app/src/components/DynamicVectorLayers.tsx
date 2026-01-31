import React, { useMemo } from "react";
import { MlVectorTileLayer } from "@mapcomponents/react-maplibre";
import { useAppStore } from "../stores/useAppStore";

interface DynamicVectorLayersProps {
  mapId?: string;
}

const DynamicVectorLayers: React.FC<DynamicVectorLayersProps> = React.memo(() => {
  const { vtLayers, terrainSettings } = useAppStore();

  // Helper function to create a safe layer ID from label and sourceLayer
  const createLayerIdSuffix = (label: string, sourceLayer: string) => {
    // Create a safe ID by removing spaces and special characters, then adding sourceLayer info
    const safeLabelId = label.toLowerCase().replace(/[^a-z0-9]/g, '-');
    return `${safeLabelId}-${sourceLayer}`;
  };

  // Create a stable dependency array
  const layerDeps = useMemo(
    () =>
      vtLayers.map((layer) => ({
        sourceLayer: layer.sourceLayer,
        label: layer.label || layer.sourceLayer, // Use label or fallback to sourceLayer
        enabled: layer.enabled,
        colorHex: layer.color, // Color is already a hex string in the unified store
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
      // Use cached hex color from layerDeps (already includes # prefix)
      const hexColor = layerDep.colorHex || "#ff0000";
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
          id: `${createLayerIdSuffix(layerDep.label, layerDep.sourceLayer)}-line`,
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
          id: `${createLayerIdSuffix(layerDep.label, layerDep.sourceLayer)}-fill`,
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
          id: `${createLayerIdSuffix(layerDep.label, layerDep.sourceLayer)}-fill`,
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

    // Add street name labels (transportation_name source layer)
    layers.push({
      id: "street-labels",
      type: "symbol",
      "source-layer": "transportation_name",
      layout: {
        visibility: "visible",
        "symbol-placement": "line",
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
        "text-max-angle": 30,
        "text-padding": 2,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#333333",
        "text-halo-width": 1.5,
      },
      minzoom: 12,
      maxzoom: 20,
    });

    // Add city/place labels (place source layer)
    layers.push({
      id: "city-labels",
      type: "symbol",
      "source-layer": "place",
      filter: ["in", "class", "city", "town", "village", "hamlet", "suburb", "neighbourhood"],
      layout: {
        visibility: "visible",
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Bold"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8, ["match", ["get", "class"], "city", 16, "town", 14, 12],
          14, ["match", ["get", "class"], "city", 24, "town", 20, 16]
        ],
        "text-anchor": "center",
        "text-padding": 4,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#222222",
        "text-halo-width": 2,
      },
      minzoom: 6,
      maxzoom: 20,
    });

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
