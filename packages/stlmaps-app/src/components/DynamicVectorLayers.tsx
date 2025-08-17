import React, { useMemo } from "react";
import { MlVectorTileLayer } from "@mapcomponents/react-maplibre";
import useLayerStore from "../stores/useLayerStore";

interface DynamicVectorLayersProps {
  mapId?: string;
}

const DynamicVectorLayers: React.FC<DynamicVectorLayersProps> = () => {
  const vtLayers = useLayerStore((state) => state.vtLayers);

  // Generate layers configuration for MlVectorTileLayer
  const vectorTileLayers = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers: any[] = [];

    for (const config of vtLayers) {
      if (!config.enabled) {
        continue;
      }

      const hexColor = `#${config.color?.getHexString() || "ff0000"}`;

      // Create layer configuration based on source layer type
      if (config.sourceLayer === "transportation") {
        // Style roads
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const layer: any = {
          id: `${config.sourceLayer}-line`,
          type: "line",
          "source-layer": config.sourceLayer,
          layout: {},
          paint: {
            "line-color": hexColor,
            "line-width": 2,
          },
          maxzoom: 20,
        };
        if (config.filter) {
          layer.filter = config.filter;
        }
        layers.push(layer);
      } else if (config.sourceLayer === "building") {
        // Style buildings
        console.log(`🏗️ Adding building fill layer with color: ${hexColor}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const layer: any = {
          id: `${config.sourceLayer}-fill`,
          type: "fill",
          "source-layer": config.sourceLayer,
          layout: {},
          paint: {
            "fill-color": hexColor,
            "fill-opacity": 1.0, // Full opacity
            "fill-outline-color": "#232323"
          },
          minzoom: 5, // Lower minzoom to show at all zoom levels
          maxzoom: 20,
        };
        if (config.filter) {
          layer.filter = config.filter;
        }
        layers.push(layer);
      } else {
        // Style other layers (water, landuse, etc.)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const layer: any = {
          id: `${config.sourceLayer}-fill`,
          type: "fill",
          "source-layer": config.sourceLayer,
          layout: {},
          paint: {
            "fill-color": hexColor,
            "fill-opacity": 0.6,
          },
          maxzoom: 20,
        };
        if (config.filter) {
          layer.filter = config.filter;
        }
        layers.push(layer);
      }
    }

    console.log("🎨 Generated vector tile layers:", layers);
    console.log("🎨 Layer details:", layers.map(l => `${l.id} (${l.type}) from ${l['source-layer']}`));
    return layers;
  }, [vtLayers]);

  console.log('render DynamicVectorLayers')
  return (
    <MlVectorTileLayer
      url="https://wms.wheregroup.com/tileserver/tile/tileserver.php?/europe-0-14/index.json?/europe-0-14/{z}/{x}/{y}.pbf"
      layers={vectorTileLayers || []}
      sourceOptions={{
        type: "vector",
        minzoom: 0,
        maxzoom: 14,
      }}
    />
  );
};

export default DynamicVectorLayers;
