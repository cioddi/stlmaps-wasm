import React, { useState, useEffect, useRef } from "react";
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
import useLayerStore from "./stores/useLayerStore";
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
  const [bboxCenter, setBboxCenter] = useState<[number, number]>([
    -74.00599999999997, 40.71279999999999,
  ]);
  const [openAttribution, setOpenAttribution] = useState(false);
  const [openInfo, setOpenInfo] = useState(false);
  const [openTodoList, setOpenTodoList] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const bboxSelectorRef = useRef<{ updateBbox: () => void } | null>(null);
  
  // Use the WebAssembly hook
  const { isInitialized, error } = useWasm();
  
  // Close sidebar by default on mobile devices
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

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

  // Get layer settings and geometries from Zustand store
  const {
    setBbox,
    isProcessing,
    processingStatus,
    processingProgress,
  } = useLayerStore();


  // Handle city selection to update both center and bbox
  const handleCitySelect = (city: { coordinates: [number, number] } | null) => {
    if (city) {
      setBboxCenter(city.coordinates);
      
      // Add a small delay to ensure state is updated before triggering bbox update
      setTimeout(() => {
        if (bboxSelectorRef.current) {
          bboxSelectorRef.current.updateBbox();
        }
      }, 100);
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
        onSidebarToggle={() => setSidebarOpen(curr => !curr)}
        onMenuToggle={() => setMenuOpen(curr => !curr)}
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
        console.log("BboxSelector onChange triggered with:", geojson);
        setBbox(geojson);
      }}
    />
    
    {/* Clean Processing Indicator */}
    {isProcessing && (
      <Paper
        elevation={6}
        sx={{
          position: 'fixed',
          bottom: '16px',
          right: '16px',
          padding: '8px 16px',
          borderRadius: '8px',
          backgroundColor: 'rgba(30, 30, 30, 0.95)',
          color: '#fff',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          minWidth: '250px',
          maxWidth: '350px',
        }}
      >
        <Typography variant="body2" sx={{ flexGrow: 1 }}>
          {processingStatus || "Processing..."}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 'bold', minWidth: '35px' }}>
          {processingProgress !== null ? `${Math.round(processingProgress)}%` : "0%"}
        </Typography>
      </Paper>
    )}
  </>
  );
};

export default App;
