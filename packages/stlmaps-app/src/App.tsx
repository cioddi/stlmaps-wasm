import React, { useState, Suspense, useEffect } from "react";
import {
  CssBaseline,
  CircularProgress,
  Box,
  Toolbar,
  Divider,
  IconButton,
  useMediaQuery,
  useTheme,
  Drawer,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ToggleButtonGroup,
  ToggleButton
} from "@mui/material";
import { MapLibreMap } from "@mapcomponents/react-maplibre";
import ModelPreview from "./components/ModelPreview";
import CitySearch from "./components/CitySearch";
import useLayerStore from "./stores/useLayerStore";
import { Sidebar } from "./components/Sidebar";
import ExportButtons from "./components/ExportButtons";
import AttributionDialog from "./components/AttributionDialog";
import ProjectTodoList from "./components/ProjectTodoList";
import InfoIcon from "@mui/icons-material/Info";
import MapIcon from "@mui/icons-material/Map";
import ViewQuiltIcon from "@mui/icons-material/ViewQuilt";
import View3dIcon from "@mui/icons-material/ViewInAr";
import BboxSelector from "./components/BboxSelector";
import { GenerateMeshButton } from "./components/GenerateMeshButton";
import { TopBar, ViewMode } from "./components/TopBar";

const mapCenter: [number, number] = [-74.00599999999997, 40.71279999999999];
const SIDEBAR_WIDTH = 440;

const App: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [bboxCenter, setBboxCenter] = useState<[number, number]>([
    -74.00599999999997, 40.71279999999999,
  ]);
  const [openAttribution, setOpenAttribution] = useState(false);
  const [openTodoList, setOpenTodoList] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  
  // Close sidebar by default on mobile devices
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  // Get layer settings and geometries from Zustand store
  const {
    terrainSettings,
    buildingSettings,
    setBbox
  } = useLayerStore();

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
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <CssBaseline />
      <TopBar 
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onOpenAttribution={() => setOpenAttribution(true)}
        onOpenTodoList={() => setOpenTodoList(true)}
        onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
        onMenuToggle={() => setMenuOpen(true)}
        onCitySelect={(city) => {
          if (city) {
            // Only update bbox center, map center is handled by CitySearch component
            setBboxCenter(city.coordinates);
          }
        }}
      />

      {/* Mobile Menu Drawer - appears from the right side */}
      <Drawer
        anchor="right"
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 20000 }}
      >
        <Box
          sx={{ width: 280 }}
          role="presentation"
        >
          <List>
            <ListItem>
              <CitySearch
                onCitySelect={(city) => {
                  if (city) {
                    setBboxCenter(city.coordinates);
                    setMenuOpen(false);
                  }
                }}
              />
            </ListItem>
            <Divider />
            <ListItem>
              <ToggleButtonGroup
                value={viewMode}
                exclusive
                onChange={(e, newMode) => {
                  if (newMode !== null) {
                    setViewMode(newMode);
                    setMenuOpen(false);
                  }
                }}
                aria-label="view mode"
                size="small"
                sx={{ width: "100%", justifyContent: "space-between" }}
              >
                <ToggleButton value="map" aria-label="map only">
                  <MapIcon /> Map
                </ToggleButton>
                <ToggleButton value="split" aria-label="split view">
                  <ViewQuiltIcon /> Split
                </ToggleButton>
                <ToggleButton value="model" aria-label="model only">
                  <View3dIcon /> 3D
                </ToggleButton>
              </ToggleButtonGroup>
            </ListItem>
            <Divider />
            <ListItem button onClick={() => {
              setOpenAttribution(true);
              setMenuOpen(false);
            }}>
              <ListItemIcon>
                <InfoIcon />
              </ListItemIcon>
              <ListItemText primary="Attribution" />
            </ListItem>
            <ListItem button onClick={() => {
              setOpenTodoList(true);
              setMenuOpen(false);
            }}>
              <ListItemIcon>
                <MapIcon />
              </ListItemIcon>
              <ListItemText primary="Roadmap" />
            </ListItem>
            <ListItem>
              <ExportButtons />
            </ListItem>
          </List>
        </Box>
      </Drawer>

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
          transition: (theme) => theme.transitions.create('margin'),
        }}
      >
        <Toolbar /> {/* Spacing below AppBar */}
        {/* Map - Top Half */}
        <Box 
          sx={{ 
            flex: mapFlex, 
            position: "relative", 
            minHeight: 0, 
            display: mapDisplay, 
            transition: theme.transitions.create(['flex', 'display'], {
              duration: theme.transitions.duration.standard,
            })
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
            options={{
              center: mapCenter,
              zoom: 14,
              style:
                "https://wms.wheregroup.com/tileserver/style/osm-bright.json",
            }}
          />
        </Box>
        {showDivider && <Divider />}
        {/* Model Preview - Bottom Half */}
        <Box
          sx={{ 
            flex: modelFlex, 
            position: "relative", 
            minHeight: 0, 
            zIndex: 10000, 
            display: modelDisplay,
            transition: theme.transitions.create(['flex', 'display'], {
              duration: theme.transitions.duration.standard,
            })
          }}
        >
          <Suspense fallback={<CircularProgress />}>
            <ModelPreview />
          </Suspense>
        </Box>
      </Box>
    </Box>

    {/* Dialogs */}
    <AttributionDialog
      open={openAttribution}
      onClose={() => setOpenAttribution(false)}
    />
    <ProjectTodoList
      open={openTodoList}
      onClose={() => setOpenTodoList(false)}
    />
    <GenerateMeshButton />

    <BboxSelector
      options={{
        center: bboxCenter,
        scale: [1, 1],
        rotate: 0,
        orientation: "portrait",
        width: 800,
        height: 800,
      }}
      onChange={(geojson) => {
        console.log("BboxSelector onChange triggered with:", geojson);
        setBbox(geojson);
      }}
    />
  </>
  );
};

export default App;
