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
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(
    null
  );
  const [bbox, setBbox] = useState<Feature | undefined>(undefined);

  function onChangeDebounced(bbox: Feature, debounceMs = 1000) {
    if (debounceTimer) clearTimeout(debounceTimer);
    const timer = setTimeout(() => {
      props.onChange?.(bbox);
    }, debounceMs);
    setDebounceTimer(timer);
  }

  useEffect(() => {
    if (bbox) {
      onChangeDebounced(bbox);
    }
  }, [bbox]);

  useEffect(() => {
    if (!mapHook.map || bbox) return;

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
  }, [mapHook.map]);

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

      // Update the bbox state
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
