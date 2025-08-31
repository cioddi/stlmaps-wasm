import React, { useEffect, useRef } from "react";
import {
  CssBaseline,
  Box,
  Toolbar,
  Divider,
  useMediaQuery,
  useTheme,
  Drawer,
  Paper,
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

const mapCenter: [number, number] = [-74.00599999999997, 40.71279999999999];
const SIDEBAR_WIDTH = 340;

const App: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const bboxSelectorRef = useRef<{ updateBbox: () => void } | null>(null);
  
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
      console.log('WASM ready in App component.');
    }
  }, [isInitialized]);
  
  // Log any WASM initialization errors
  useEffect(() => {
    if (error) {
      console.error('Failed to initialize WASM:', error);
    }
  }, [error]);


  // Handle city selection to update both center and bbox  
  const handleCitySelect = (city: { coordinates: [number, number] } | null) => {
    if (city) {
      console.log("🏙️ City selected:", city);
      
      // Clear any existing bbox first to ensure React detects the change
      setBbox(null);
      setBboxCenter(city.coordinates);
      
      // Wait for map animation to complete, then update bbox
      setTimeout(() => {
        if (bboxSelectorRef.current) {
          console.log("🔄 Updating bbox after city jump...");
          try {
            bboxSelectorRef.current.updateBbox();
            console.log("✅ Bbox updated - should trigger automatic geometry processing");
          } catch (error) {
            console.error("❌ Failed to update bbox after city jump:", error);
          }
        } else {
          console.warn("⚠️ BboxSelector ref not available for updateBbox");
        }
      }, 500);
    }
  };
  
  const handleViewModeChange = (
    event: React.MouseEvent<HTMLElement>,
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

  return (<>
    <MlOrderLayers layerIds={['controls-order-layer','data-order-layer']} />
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
        <Sidebar bboxCenter={bboxCenter} />
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
          mapCenter={mapCenter}
          flex={mapFlex}
          display={mapDisplay}
          bboxSelectorRef={bboxSelectorRef}
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
      options={{
        scale: [1, 1],
        rotate: 0,
        width: 200,
        height: 200,
      }}
      onChange={(geojson) => {
        console.log("🔄 BboxSelector onChange triggered");
        console.log("📦 New bbox geojson:", geojson);
        
        // Validate bbox geometry before setting
        if (geojson && geojson.geometry && geojson.geometry.coordinates) {
          const coords = geojson.geometry.coordinates[0];
          if (coords && coords.length >= 5) {
            const [topLeftLng, topLeftLat] = coords[0];
            const [topRightLng, topRightLat] = coords[1];
            const [bottomRightLng, bottomRightLat] = coords[2];
            const [bottomLeftLng, bottomLeftLat] = coords[3];
            
            console.log("🗺️ Bbox bounds:", {
              topLeft: [topLeftLng, topLeftLat],
              topRight: [topRightLng, topRightLat], 
              bottomRight: [bottomRightLng, bottomRightLat],
              bottomLeft: [bottomLeftLng, bottomLeftLat],
              width: Math.abs(topRightLng - topLeftLng),
              height: Math.abs(topLeftLat - bottomLeftLat)
            });
            
            // Check for invalid coordinates
            const allCoords = [topLeftLng, topLeftLat, topRightLng, topRightLat, bottomRightLng, bottomRightLat, bottomLeftLng, bottomLeftLat];
            const hasInvalidCoords = allCoords.some(coord => !Number.isFinite(coord));
            
            if (hasInvalidCoords) {
              console.error("❌ Invalid bbox coordinates detected!", allCoords);
              return;
            }
            
            setBbox(geojson);
            console.log("✅ Bbox updated successfully");
          } else {
            console.error("❌ Invalid bbox geometry - insufficient coordinates:", coords);
          }
        } else {
          console.error("❌ Invalid bbox geojson structure:", geojson);
        }
      }}
    />

  </>
  );
};

export default App;
