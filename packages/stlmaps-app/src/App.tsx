import React, { useEffect, useRef, useMemo } from "react";
import {
  CssBaseline,
  Box,
  Toolbar,
  Divider,
  useMediaQuery,
  useTheme,
  Drawer,
  Typography,
} from "@mui/material";
import { useAppStore } from "./stores/useAppStore";
import { Sidebar } from "./components/Sidebar";
import AttributionDialog from "./components/AttributionDialog";
import InfoDialog from "./components/InfoDialog";
import ProjectTodoList from "./components/ProjectTodoList";
import BboxSelector from "./components/BboxSelector";
import { GenerateMeshButton } from "./components/GenerateMeshButton";
import { TopBar, ViewMode } from "./components/TopBar";
import MobileMenu from "./components/MobileMenu";
import MapSection from "./components/MapSection";
import ModelSection from "./components/ModelSection";
import { useWasm } from "@threegis/core";
import DynamicVectorLayers from "./components/DynamicVectorLayers";
import { MlOrderLayers } from "@mapcomponents/react-maplibre";
import { useUrlState } from "./hooks/useUrlState";

const mapCenter: [number, number] = [-74.00599999999997, 40.71279999999999];
const SIDEBAR_WIDTH = 340;

const App: React.FC = () => {
  const { isInitialized: urlStateInitialized } = useUrlState();

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const bboxSelectorRef = useRef<{ updateBbox: () => void; setBbox: (geojson: import('geojson').Feature) => void; getBbox: () => import('geojson').Feature | undefined } | null>(null);

  // Use the WebAssembly hook
  const { isInitialized, error } = useWasm();

  // Get all state from unified Zustand store
  const {
    bboxCenter,
    setBboxCenter,
    bbox,
    setBbox,
    viewMode,
    setViewMode,
    sidebarOpen,
    setSidebarOpen,
    menuOpen,
    setMenuOpen,
    openAttribution,
    setOpenAttribution,
    openInfo,
    setOpenInfo,
    openTodoList,
    setOpenTodoList,
  } = useAppStore();

  // Close sidebar by default on mobile devices
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile, setSidebarOpen]);

  // Use the Rust functions when WASM is initialized
  useEffect(() => {
    if (isInitialized) {
      // WASM ready
    }
  }, [isInitialized]);

  // Log any WASM initialization errors
  useEffect(() => {
    if (error) {
      // WASM initialization failed
    }
  }, [error]);


  // Handle city selection to update both center and bbox  
  const handleCitySelect = (city: { coordinates: [number, number] } | null) => {
    if (city) {
      // City selected

      // Clear any existing bbox first to ensure React detects the change
      setBbox(null);
      setBboxCenter(city.coordinates);

      // Wait for map animation to complete, then update bbox
      setTimeout(() => {
        if (bboxSelectorRef.current) {
          // Updating bbox after city jump
          try {
            bboxSelectorRef.current.updateBbox();
            // Bbox updated
          } catch (error) {
            // Failed to update bbox after city jump
          }
        } else {
          // BboxSelector ref not available for updateBbox
        }
      }, 500);
    }
  };


  // Calculate initial bounds if bbox exists on load - ONLY ONCE
  const [initialBounds, setInitialBounds] = React.useState<[number, number, number, number] | undefined>(undefined);
  const initialBoundsSet = useRef(false);

  useEffect(() => {
    // Only calculate if URL state is initialized, we have a polygon bbox, and haven't set it yet
    if (urlStateInitialized && bbox && bbox.geometry.type === 'Polygon' && !initialBoundsSet.current) {
      const coords = bbox.geometry.coordinates[0];
      if (coords && coords.length > 0) {
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        coords.forEach(([lng, lat]) => {
          minLng = Math.min(minLng, lng);
          minLat = Math.min(minLat, lat);
          maxLng = Math.max(maxLng, lng);
          maxLat = Math.max(maxLat, lat);
        });

        // Return bounds in [minLng, minLat, maxLng, maxLat] format
        if (isFinite(minLng) && isFinite(minLat) && isFinite(maxLng) && isFinite(maxLat)) {
          setInitialBounds([minLng, minLat, maxLng, maxLat]);
          initialBoundsSet.current = true;
        }
      }
    }
  }, [urlStateInitialized, bbox]);

  const handleViewModeChange = (
    _event: React.MouseEvent<HTMLElement>,
    newMode: ViewMode | null,
  ) => {
    if (newMode !== null) {
      setViewMode(newMode);
    }
  };

  // Calculate flex values and height constraints based on view mode
  const mapFlex = viewMode === "map" ? 1 : viewMode === "split" ? 0.5 : 0;
  const modelFlex = viewMode === "model" ? 1 : viewMode === "split" ? 0.5 : 0;
  const mapDisplay = viewMode === "model" ? "none" : "flex";
  const modelDisplay = viewMode === "map" ? "none" : "flex";
  const showDivider = viewMode === "split";

  if (!urlStateInitialized) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Typography>Loading configuration...</Typography>
      </Box>
    );
  }

  return (<>
    <MlOrderLayers layerIds={['controls-order-layer', 'data-order-layer']} />
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <CssBaseline />
      <TopBar
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onOpenAttribution={() => setOpenAttribution(true)}
        onOpenInfo={() => setOpenInfo(true)}
        onOpenTodoList={() => setOpenTodoList(true)}
        onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
        onMenuToggle={() => setMenuOpen(!menuOpen)}
        onCitySelect={handleCitySelect}
      />

      {/* Mobile Menu Drawer */}
      <MobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onCitySelect={handleCitySelect}
        onOpenAttribution={() => setOpenAttribution(true)}
        onOpenInfo={() => setOpenInfo(true)}
        onOpenTodoList={() => setOpenTodoList(true)}
      />

      {/* Slideable Sidebar - changes between temporary and permanent based on screen size */}
      <Drawer
        variant={isMobile ? "temporary" : "permanent"}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sx={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: {
            width: SIDEBAR_WIDTH,
            boxSizing: "border-box",
          },
        }}
      >
        <Toolbar /> {/* Spacing below AppBar */}
        <Sidebar />
      </Drawer>

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          ml: { xs: 0 },
        }}
      >
        <Toolbar /> {/* Spacing below AppBar */}
        {/* Map - Top Half */}
        <MapSection
          mapCenter={bboxCenter || mapCenter}
          flex={mapFlex}
          display={mapDisplay}
          bboxSelectorRef={bboxSelectorRef}
          initialBounds={initialBounds}
        />
        <DynamicVectorLayers />
        {showDivider && <Divider />}
        {/* Model Preview - Bottom Half */}
        <ModelSection
          flex={modelFlex}
          display={modelDisplay}
        />
      </Box>
    </Box>

    {/* Dialogs */}
    <AttributionDialog
      open={openAttribution}
      onClose={() => setOpenAttribution(false)}
    />
    <InfoDialog
      open={openInfo}
      onClose={() => setOpenInfo(false)}
    />
    <ProjectTodoList
      open={openTodoList}
      onClose={() => setOpenTodoList(false)}
    />
    <GenerateMeshButton />
    <BboxSelector
      ref={bboxSelectorRef}
      initialGeojson={bbox}
      options={{
        scale: [1, 1],
        rotate: 0,
        width: 200,
        height: 200,
      }}
      onChange={(geojson) => {
        // BboxSelector onChange triggered
        // New bbox geojson received

        // Validate bbox geometry before setting
        if (geojson && geojson.geometry && geojson.geometry.type === 'Polygon') {
          const coords = geojson.geometry.coordinates[0];
          if (coords && coords.length >= 5) {
            const [topLeftLng, topLeftLat] = coords[0];
            const [topRightLng, topRightLat] = coords[1];
            const [bottomRightLng, bottomRightLat] = coords[2];
            const [bottomLeftLng, bottomLeftLat] = coords[3];

            // Bbox bounds calculated

            // Check for invalid coordinates
            const allCoords = [topLeftLng, topLeftLat, topRightLng, topRightLat, bottomRightLng, bottomRightLat, bottomLeftLng, bottomLeftLat];
            const hasInvalidCoords = allCoords.some(coord => !Number.isFinite(coord));

            if (hasInvalidCoords) {
              // Invalid bbox coordinates detected
              return;
            }

            setBbox(geojson);
            // Bbox updated successfully
          } else {
            // Invalid bbox geometry - insufficient coordinates
          }
        } else {
          // Invalid bbox geojson structure
        }
      }}
    />

  </>
  );
};

export default App;
