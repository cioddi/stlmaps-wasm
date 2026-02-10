import {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  useMap,
  MlGeoJsonLayer,
} from "@mapcomponents/react-maplibre";
import { Feature } from "geojson";
import BboxSelectorEditMode from "./BboxSelectorEditMode";

export interface BboxSelectorOptions {
  topLeft?: [number, number] | undefined;
  scale: [number, number] | undefined;
  rotate: number;
  width: number;
  height: number;
  fixedScale?: boolean;
}


type Props = {
  /**
   * Id of the target MapLibre instance in mapContext
   */
  mapId?: string;
  /**
   * a state variable containing the PDF previews current state
   */
  options: BboxSelectorOptions;
  /**
   * setter function to update the current PDF preview state
   */
  setOptions?: (
    arg1:
      | ((val: BboxSelectorOptions) => BboxSelectorOptions)
      | BboxSelectorOptions
  ) => void;
  onChange?: (geojson: Feature) => void;
  /**
   * Initial GeoJSON Feature to use for the bbox (e.g., from URL config).
   * If provided, this will be used instead of creating a bbox from the map viewport.
   */
  initialGeojson?: Feature | null;
};

/**
 * BboxSelector component renders a transformable (drag, scale, rotate) preview of the desired export or print content
 */
const BboxSelector = forwardRef((props: Props, ref) => {
  const mapHook = useMap({
    mapId: props.mapId,
  });
  const [mode, setMode] = useState<"view" | "edit">("view");
  const modeRef = useRef<"view" | "edit">("view");
  const [bbox, setBbox] = useState<Feature | undefined>(undefined);
  // Track whether the last bbox update was from internal editing (vs external prop)
  const isInternalUpdateRef = useRef(false);
  // Track the last prop geometry string to detect external changes
  const lastPropGeometryRef = useRef<string | null>(null);

  // Call onChange immediately when bbox changes from internal edits (drag/resize)
  // This ensures the store is updated before any viewport changes can occur
  useEffect(() => {
    if (bbox && isInternalUpdateRef.current) {
      props.onChange?.(bbox);
      isInternalUpdateRef.current = false; // Reset after notifying
    }
  }, [bbox]);

  // Sync internal state with external prop (e.g. from shift buttons)
  // Only update if the prop geometry actually changed from what we last saw
  useEffect(() => {
    if (props.initialGeojson) {
      const propGeometryStr = JSON.stringify(props.initialGeojson.geometry);

      // Only sync if this is a genuinely new external change
      if (propGeometryStr !== lastPropGeometryRef.current) {
        lastPropGeometryRef.current = propGeometryStr;

        // Check if different from current bbox
        const currentGeometryStr = bbox ? JSON.stringify(bbox.geometry) : null;
        if (propGeometryStr !== currentGeometryStr) {
          // This is an external update, don't trigger onChange
          isInternalUpdateRef.current = false;
          setBbox(props.initialGeojson);
        }
      }
    }
  }, [props.initialGeojson]);

  useEffect(() => {
    if (!mapHook.map || bbox) return;

    // If initialGeojson is provided, use it instead of creating a new bbox
    if (props.initialGeojson) {
      setBbox(props.initialGeojson);
      return;
    }

    mapHook.map.map.dragRotate.disable();
    mapHook.map.map.touchZoomRotate.disableRotation();
    // Create a default bbox in the center using pixel coordinates
    // Get the map container dimensions
    const container = mapHook.map.map.getContainer();
    const centerX = container.clientWidth / 2;
    const centerY = container.clientHeight / 2;

    // Define a default pixel width and height (adjusted for zoom level)
    const defaultWidth = props.options.width || 100;
    const defaultHeight = props.options.height || 100;

    // Calculate pixel coordinates for corners
    const topLeftPixelX = centerX - defaultWidth / 2;
    const topLeftPixelY = centerY - defaultHeight / 2;
    const topRightPixelX = centerX + defaultWidth / 2;
    const topRightPixelY = centerY - defaultHeight / 2;
    const bottomRightPixelX = centerX + defaultWidth / 2;
    const bottomRightPixelY = centerY + defaultHeight / 2;
    const bottomLeftPixelX = centerX - defaultWidth / 2;
    const bottomLeftPixelY = centerY + defaultHeight / 2;

    // Convert pixel coordinates to geographical coordinates using unproject
    const topLeft = mapHook.map.map.unproject([topLeftPixelX, topLeftPixelY]);
    const topRight = mapHook.map.map.unproject([
      topRightPixelX,
      topRightPixelY,
    ]);
    const bottomRight = mapHook.map.map.unproject([
      bottomRightPixelX,
      bottomRightPixelY,
    ]);
    const bottomLeft = mapHook.map.map.unproject([
      bottomLeftPixelX,
      bottomLeftPixelY,
    ]);

    // Create GeoJSON feature from unprojected coordinates
    const _geoJson = {
      type: "Feature",
      bbox: [topLeft.lng, topLeft.lat, bottomRight.lng, bottomRight.lat],
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [topLeft.lng, topLeft.lat],
            [topRight.lng, topRight.lat],
            [bottomRight.lng, bottomRight.lat],
            [bottomLeft.lng, bottomLeft.lat],
            [topLeft.lng, topLeft.lat],
          ],
        ],
      },
      properties: {
        description: "click to edit",
      },
    } as Feature;
    setBbox(_geoJson);
  }, [mapHook.map, props.initialGeojson]);

  const handleBboxClick = (e?: any) => {
    // Ensure we're in view mode before switching
    if (modeRef.current !== "view") {

      return;
    }



    // Prevent event bubbling to avoid map interactions
    if (e && e.originalEvent) {
      e.originalEvent.stopPropagation();
      e.originalEvent.preventDefault();
    }

    // Immediately update mode to prevent double-clicks
    modeRef.current = "edit";
    setMode("edit");

    // Set up exit conditions immediately but with proper guards
    if (mapHook.map) {
      const exitToView = () => {

        if (modeRef.current === "edit") {
          modeRef.current = "view";
          setMode("view");
        }
      };

      // Use nextTick to ensure handlers are set after current event processing
      Promise.resolve().then(() => {
        if (modeRef.current === "edit" && mapHook.map) {
          mapHook.map.map.once("dragstart", exitToView);
          mapHook.map.map.once("rotatestart", exitToView);
          mapHook.map.map.once("zoomstart", exitToView);
        }
      });
    }
  };

  const handleBboxUpdate = (updatedBbox: Feature) => {
    isInternalUpdateRef.current = true; // Mark as internal edit
    setBbox(updatedBbox);
  };

  // Render the GeoJSON layer in view mode
  const renderViewMode = () => {
    if (!bbox) return null;

    return (
      <>
        <MlGeoJsonLayer
          insertBeforeLayer="controls-order-layer"
          geojson={bbox}
          layerId="bbox-selector-layer"
          mapId={props.mapId}
          onClick={handleBboxClick}
          type="fill"
          labelProp="description"
          options={{
            paint: {
              "fill-color": "rgba(200, 200, 200, 0.6)",
              "fill-opacity": 0.8,
              "fill-outline-color": "rgba(45, 139, 246, 1)",
            },
          }}
        />
        <MlGeoJsonLayer
          insertBeforeLayer="controls-order-layer"
          geojson={bbox}
          layerId="bbox-selector-layer-circles"
          mapId={props.mapId}
          onClick={handleBboxClick}
          type="circle"
          options={{
            paint: {
              "circle-color": "rgb(87, 87, 87)",
              "circle-radius": 8,
              "circle-opacity": 0.4,
              "circle-stroke-color": "rgb(255, 255, 255)",
            },
          }}
        />
      </>
    );
  };

  // Expose methods through ref
  useImperativeHandle(ref, () => ({
    // Set bbox to a specific GeoJSON Feature (used for loading from URL config)
    setBbox: (geojson: Feature) => {
      setBbox(geojson);
    },
    // Get the current bbox
    getBbox: () => bbox,
    updateBbox: () => {
      // Create a new bbox based on the current map center
      if (!mapHook.map) return;

      // Get the map container dimensions
      const container = mapHook.map.map.getContainer();
      const centerX = container.clientWidth / 2;
      const centerY = container.clientHeight / 2;

      // Define dimensions based on props options
      const defaultWidth = props.options.width || 100;
      const defaultHeight = props.options.height || 100;

      // Calculate pixel coordinates for corners
      const topLeftPixelX = centerX - defaultWidth / 2;
      const topLeftPixelY = centerY - defaultHeight / 2;
      const topRightPixelX = centerX + defaultWidth / 2;
      const topRightPixelY = centerY - defaultHeight / 2;
      const bottomRightPixelX = centerX + defaultWidth / 2;
      const bottomRightPixelY = centerY + defaultHeight / 2;
      const bottomLeftPixelX = centerX - defaultWidth / 2;
      const bottomLeftPixelY = centerY + defaultHeight / 2;

      // Convert pixel coordinates to geographical coordinates
      const topLeft = mapHook.map.map.unproject([topLeftPixelX, topLeftPixelY]);
      const topRight = mapHook.map.map.unproject([
        topRightPixelX,
        topRightPixelY,
      ]);
      const bottomRight = mapHook.map.map.unproject([
        bottomRightPixelX,
        bottomRightPixelY,
      ]);
      const bottomLeft = mapHook.map.map.unproject([
        bottomLeftPixelX,
        bottomLeftPixelY,
      ]);

      // Create updated GeoJSON feature
      const updatedGeoJson = {
        type: "Feature",
        bbox: [topLeft.lng, topLeft.lat, bottomRight.lng, bottomRight.lat],
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [topLeft.lng, topLeft.lat],
              [topRight.lng, topRight.lat],
              [bottomRight.lng, bottomRight.lat],
              [bottomLeft.lng, bottomLeft.lat],
              [topLeft.lng, topLeft.lat],
            ],
          ],
        },
        properties: {
          description: "click to edit",
        },
      } as Feature;

      // Update the bbox state (mark as internal so onChange fires)
      isInternalUpdateRef.current = true;
      setBbox(updatedGeoJson);
    },
  }));

  return (
    <>
      {/* Always render the view mode GeoJSON component */}
      {mode === "view" && bbox && renderViewMode()}

      {/* Render the edit mode component only when in edit mode */}
      {mode === "edit" && bbox && (
        <BboxSelectorEditMode
          mapId={props.mapId}
          options={props.options}
          bbox={bbox}
          mapHook={mapHook}
          onBboxUpdate={handleBboxUpdate}
        />
      )}
    </>
  );
});

export default BboxSelector;
