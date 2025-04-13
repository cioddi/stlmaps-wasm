import React, { useState, Suspense, useEffect } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  CssBaseline,
  CircularProgress,
  Box,
  Divider,
  Button,
  IconButton,
  useMediaQuery,
  useTheme,
  Drawer,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
} from "@mui/material";
import { MapLibreMap } from "@mapcomponents/react-maplibre";
import ModelPreview from "./components/ModelPreview";
import CitySearch from "./components/CitySearch";
import useLayerStore from "./stores/useLayerStore";
import { Sidebar } from "./components/Sidebar";
import ExportButtons from "./components/ExportButtons";
import AttributionDialog from "./components/AttributionDialog";
import ProjectTodoList from "./components/ProjectTodoList";
import ProcessingIndicator from "./components/ProcessingIndicator";
import MenuIcon from "@mui/icons-material/Menu";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import InfoIcon from "@mui/icons-material/Info";
import MapIcon from "@mui/icons-material/Map";

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
  
  // Close sidebar by default on mobile devices
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  // Get layer settings and geometries from Zustand store
  const {
    terrainSettings,
    buildingSettings,
    polygonGeometries,
    terrainGeometry,
    buildingsGeometry
  } = useLayerStore();


  return (<>
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 10000 }}
      >
        <Toolbar sx={{ display: "flex", justifyContent: "space-between" }}>
          <Box sx={{ display: "flex", alignItems: "center" }}>
            {isMobile && (
              <IconButton
                color="secondary"
                edge="start"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                sx={{ mr: 2 }}
              >
                <MenuIcon />
              </IconButton>
            )}
            <Typography variant="h6" color="primary">
              STLmaps
            </Typography>
          </Box>
          
          {/* Middle section - Only visible on desktop */}
          {!isMobile && (
            <CitySearch
              onCitySelect={(city) => {
                if (city) {
                  // Only update bbox center, map center is handled by CitySearch component
                  setBboxCenter(city.coordinates);
                }
              }}
            />
          )}

          {/* Right side topbar buttons */}
          <Box sx={{ display: "flex", gap: 1 }}>
            {/* Export button - Always visible with just icon on mobile */}
            <ExportButtons />
            
            {/* Hamburger menu button - Only on mobile */}
            {isMobile && (
              <IconButton
                color="secondary"
                onClick={() => setMenuOpen(true)}
              >
                <MenuIcon />
              </IconButton>
            )}

            {/* Desktop buttons */}
            {!isMobile && (
              <>
                <Button
                  variant="outlined"
                  onClick={() => setOpenAttribution(true)}
                  color="secondary"
                >
                  Attribution
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => setOpenTodoList(true)}
                  color="secondary"
                >
                  Roadmap
                </Button>
                <ProcessingIndicator />
              </>
            )}
          </Box>
        </Toolbar>
      </AppBar>

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
        <Box sx={{ flex: 1, position: "relative", minHeight: 0 }}>
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
        <Divider />
        {/* Model Preview - Bottom Half */}
        <Box
          sx={{ flex: 1, position: "relative", minHeight: 0, zIndex: 10000 }}
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
  </>
  );
};

export default App;
