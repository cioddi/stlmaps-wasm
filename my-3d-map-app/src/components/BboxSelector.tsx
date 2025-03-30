import React, { useRef, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom";
import Moveable from "react-moveable";
import { useMap, useMapState } from "@mapcomponents/react-maplibre";
import * as turf from "@turf/turf";
import { LngLatLike, Map as MapType, PointLike } from "maplibre-gl";
import { Units } from "@turf/turf";
import { Feature } from "geojson";

export interface BboxSelectorOptions {
  center: [number, number] | undefined;
  scale: [number, number] | undefined;
  rotate: number;
  width: number;
  height: number;
  fixedScale?: number | false;
  orientation: "portrait" | "landscape";
}

type Props = {
  /**
   * Id of the target MapLibre instance in mapContext
   */
  mapId?: string;
  /**
   * Polygon GeoJson Feature representing the printing area
   */
  geojsonRef: React.MutableRefObject<Feature | undefined>;
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

function getTargetRotationAngle(target: HTMLDivElement) {
  const el_style = window.getComputedStyle(target, null);
  const el_transform = el_style.getPropertyValue("transform");

  let deg = 0;

  if (el_transform !== "none") {
    const values = el_transform.split("(")[1].split(")")[0].split(",");
    const a = parseFloat(values[0]);
    const b = parseFloat(values[1]);
    deg = Math.round(Math.atan2(b, a) * (180 / Math.PI));
  }

  return deg < 0 ? deg + 360 : deg;
}

function calcElemTransformedPoint(
  el: HTMLDivElement,
  point: [number, number],
  transformOrigin: [number, number]
): PointLike {
  const style = getComputedStyle(el);
  const p = [point[0] - transformOrigin[0], point[1] - transformOrigin[1]];

  const matrix = new DOMMatrixReadOnly(style.transform);

  // transform pixel coordinates according to the css transform state of "el" (target)
  return [
    p[0] * matrix.a + p[1] * matrix.c + matrix.e + transformOrigin[0],
    p[0] * matrix.b + p[1] * matrix.d + matrix.f + transformOrigin[1],
  ];
}

// measure distance in pixels that is used to determine the current css transform.scale relative to the maps viewport.zoom
const scaleAnchorInPixels = 10;

// used to determine the MapZoomScale modifier which is multiplied with options.scale to relate the scale to the current map viewport.zoom
function getMapZoomScaleModifier(point: [number, number], _map: MapType) {
  const left = _map.unproject(point);
  const right = _map.unproject([point[0] + scaleAnchorInPixels, point[1]]);
  const maxMeters = left.distanceTo(right);
  return scaleAnchorInPixels / maxMeters;
}

/**
 * BboxSelector component renders a transformable (drag, scale, rotate) preview of the desired export or print content
 */
export default function BboxSelector(props: Props) {
  const [options, setOptions] = React.useState<BboxSelectorOptions>(
    props.options
  );
  const mapState = useMapState({
    mapId: props.mapId,
    watch: { layers: false, viewport: true },
  });
  const targetRef = useRef<HTMLDivElement>(null);
  const fixedScaleRef = useRef<number | null>(null);
  const moveableRef = useRef<Moveable>(null);
  const mapHook = useMap({
    mapId: props.mapId,
  });
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);
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
    if (typeof props.setOptions === "function") {
      props.setOptions(options);
    }
  }, [options, props]);

  useEffect(() => {
    if (!mapState?.viewport?.zoom || !mapHook.map) return;
    // if the component was initialized with scale or center as undefined derive those values from the current map view state

    //initialize props if not defined
    const _centerX = Math.round(mapHook.map.map._container.clientWidth / 2);
    const _centerY = Math.round(mapHook.map.map._container.clientHeight / 2);

    if (!options.scale) {
      //const scale = parseFloat(/(14/mapState.viewport.zoom));
      const scale =
        1 / getMapZoomScaleModifier([_centerX, _centerY], mapHook.map.map);

      setOptions((val: BboxSelectorOptions) => ({
        ...val,
        scale: [scale, scale],
      }));
    }
    if (!options.center) {
      const _center = mapHook.map.map.unproject([_centerX, _centerY]);
      setOptions((val: BboxSelectorOptions) => ({
        ...val,
        center: [_center.lng, _center.lat],
      }));
    }
  }, [mapHook.map, mapState.viewport?.zoom, options?.scale, options?.center]);

  useEffect(() => {
    if (!mapHook.map) return;

    mapHook.map.map.setPitch(0);
    const _maxPitch = mapHook.map.map.getMaxPitch();
    mapHook.map.map.setMaxPitch(0);
    return () => {
      mapHook.map?.map.setMaxPitch(_maxPitch);
    };
  }, [mapHook.map]);

  const transformOrigin = useMemo<[number, number]>(() => {
    if (options.orientation === "portrait") {
      return [options.width / 2, options.height / 2];
    } else {
      return [options.height / 2, options.width / 2];
    }
  }, [options.orientation, options.width, options.height]);

  const transform = useMemo(() => {
    if (!mapHook.map || !options.scale) return "none";

    const centerInPixels = mapHook.map.map.project(
      options.center as LngLatLike
    );

    const x = centerInPixels.x;
    const y = centerInPixels.y;
    const scale =
      options.scale[0] * getMapZoomScaleModifier([x, y], mapHook.map.map);

    const viewportBearing = mapState?.viewport?.bearing
      ? mapState.viewport?.bearing
      : 0;

    const _transform = `translate(${Math.floor(
      centerInPixels.x - transformOrigin[0]
    )}px,${Math.floor(centerInPixels.y - transformOrigin[1])}px) rotate(${
      options.rotate - viewportBearing
    }deg) scale(${scale},${scale})`;

    if (targetRef.current) targetRef.current.style.transform = _transform;

    return _transform;
  }, [
    mapHook.map,
    mapState.viewport,
    options.scale,
    options.rotate,
    options.center,
    transformOrigin,
  ]);

  useEffect(() => {
    moveableRef.current?.updateTarget();
  }, [transform]);

  useEffect(() => {
    // update options.scale if fixedScale was changed
    if (
      !mapHook.map ||
      !options?.center ||
      !options?.fixedScale ||
      (typeof options?.fixedScale !== "undefined" &&
        fixedScaleRef.current === options?.fixedScale)
    )
      return;

    fixedScaleRef.current = options.fixedScale;
    const point = turf.point(options.center);
    const distance = options.fixedScale * (options.width / 1000);

    const bearing = 90;
    const _options = { units: "meters" as Units };
    const destination = turf.destination(point, distance, bearing, _options);

    const centerInPixels = mapHook.map.map.project(
      point.geometry.coordinates as LngLatLike
    );
    const destinationInPixels = mapHook.map.map.project(
      destination.geometry.coordinates as LngLatLike
    );

    const scaleFactor =
      (Math.round(destinationInPixels.x - centerInPixels.x) / options.width) *
      (1 /
        getMapZoomScaleModifier(
          [centerInPixels.x, centerInPixels.y],
          mapHook.map.map
        ));
    setOptions((val: BboxSelectorOptions) => ({
      ...val,
      scale: [scaleFactor, scaleFactor],
    }));
  }, [mapHook.map, options.width, options.center, options.fixedScale]);

  // update props.geoJsonRef
  useEffect(() => {
    if (targetRef.current && mapHook.map) {
      // apply orientation
      let _width = options.width;
      let _height = options.height;
      if (options.orientation === "portrait") {
        targetRef.current.style.width = options.width + "px";
        targetRef.current.style.height = options.height + "px";
      } else {
        targetRef.current.style.width = options.height + "px";
        targetRef.current.style.height = options.width + "px";
        _width = options.height;
        _height = options.width;
      }
      moveableRef.current?.updateTarget();

      const topLeft = mapHook.map.map.unproject(
        calcElemTransformedPoint(targetRef.current, [0, 0], transformOrigin)
      );
      const topRight = mapHook.map.map.unproject(
        calcElemTransformedPoint(
          targetRef.current,
          [_width, 0],
          transformOrigin
        )
      );
      const bottomLeft = mapHook.map.map.unproject(
        calcElemTransformedPoint(
          targetRef.current,
          [0, _height],
          transformOrigin
        )
      );
      const bottomRight = mapHook.map.map.unproject(
        calcElemTransformedPoint(
          targetRef.current,
          [_width, _height],
          transformOrigin
        )
      );

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
        properties: { bearing: getTargetRotationAngle(targetRef.current) },
      } as Feature;
      console.log('update bbox', _geoJson);
      setBbox(_geoJson)
      props.geojsonRef.current = _geoJson;
    }

    return undefined;
  }, [
    mapHook.map,
    transform,
    options?.orientation,
    options?.height,
    options?.width,
    props.geojsonRef,
    transformOrigin,
    mapState.viewport?.center
  ]);

  return mapHook?.map?.map?._canvas?.parentNode?.parentNode ? (
    ReactDOM.createPortal(
      <>
        <div
          className="target"
          ref={targetRef}
          style={{ transform: transform, transformOrigin: "center center" }}
        ></div>
        <Moveable
          // eslint-disable-next-line
          // @ts-ignore:
          ref={moveableRef}
          target={targetRef}
          container={null}
          origin={true}
          keepRatio={true}
          /* draggable */
          draggable={true}
          onDrag={(e) => {
            if (mapHook.map) {
              let _transformParts = e.transform.split("translate(");
              _transformParts = _transformParts[1]
                .split("px)")[0]
                .split("px, ");
              const _center = mapHook.map?.map.unproject([
                parseInt(_transformParts[0]) + transformOrigin[0],
                parseInt(_transformParts[1]) + transformOrigin[1],
              ]);
              setOptions((val: BboxSelectorOptions) => ({
                ...val,
                center: [_center.lng, _center.lat],
              }));
            }
          }}
          /* scalable */
          scalable={options.fixedScale ? false : true}
          onScale={(e) => {
            if (mapHook.map) {
              let _transformParts = e.drag.transform.split("scale(");
              _transformParts = _transformParts[1].split(")")[0].split(", ");

              const centerInPixels = mapHook.map.map.project(
                options.center as LngLatLike
              );

              const x = centerInPixels.x;
              const y = centerInPixels.y;

              const scale =
                parseFloat(_transformParts[0]) *
                (1 / getMapZoomScaleModifier([x, y], mapHook.map.map));

              setOptions((val: BboxSelectorOptions) => ({
                ...val,
                scale: [scale, scale],
              }));
            }
          }}
          /* rotatable */
          rotatable={true}
          onRotate={(e) => {
            if (mapHook.map && mapState.viewport) {
              const _transformParts = e.drag.transform.split("rotate(");
              const _transformPartString = _transformParts[1].split("deg)")[0];
              const viewportBearing = mapState?.viewport?.bearing
                ? mapState.viewport.bearing
                : 0;

              setOptions((val: BboxSelectorOptions) => ({
                ...val,
                rotate: parseFloat(_transformPartString) + viewportBearing,
              }));
            }
          }}
        />
      </>,
      mapHook.map.map._canvas.parentNode.parentElement as HTMLElement
    )
  ) : (
    <></>
  );
}
