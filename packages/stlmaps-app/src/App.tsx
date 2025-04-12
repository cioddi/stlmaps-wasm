import React, { useState, useRef, Suspense, useEffect } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  CssBaseline,
  CircularProgress,
  Box,
  Drawer,
  Divider,
  Tab,
  Tabs,
} from "@mui/material";
import { MapLibreMap } from "@mapcomponents/react-maplibre";
import BboxSelector from "./components/BboxSelector";
import ModelPreview from "./components/ModelPreview";
import { GenerateMeshButton } from "./components/GenerateMeshButton";
import ExportButtons from "./components/ExportButtons";
import AttributionDialog from "./components/AttributionDialog";
import ProjectTodoList from "./components/ProjectTodoList";
import CitySearch from "./components/CitySearch";
import LayerList from "./components/LayerList";
import useLayerStore from "./stores/useLayerStore";

const SIDEBAR_WIDTH = 440;
const mapCenter = [-74.00599999999997, 40.71279999999999];

const App: React.FC = () => {
  const bboxRef = useRef<GeoJSON.Feature | undefined>(undefined);
  const [polygonGeometries, setPolygonGeometries] = useState<
    THREE.BufferGeometry[] | null
  >(null);
  const [terrainGeometry, setTerrainGeometry] =
    useState<THREE.BufferGeometry | null>(null);
  const [buildingsGeometry, setBuildingsGeometry] =
    useState<THREE.BufferGeometry | null>(null);
  const [bboxCenter, setBboxCenter] = useState<[number, number]>([
    -74.00599999999997, 40.71279999999999,
  ]);
  const [openAttribution, setOpenAttribution] = useState(false);
  const [openTodoList, setOpenTodoList] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  
  // Get layer settings from Zustand store
  const { terrainSettings, buildingSettings, vtLayers, bbox, setBbox } = useLayerStore();
  
  
  // Initialize with default bbox if none exists to kickstart model generation
  useEffect(() => {
    if (!bbox && bboxRef.current) {
      console.log("Setting initial bbox from ref to trigger model generation");
      setBbox(bboxRef.current);
    }
  }, [bbox, setBbox, bboxRef]);

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 10000 }}
      >
        <Toolbar sx={{ display: "flex", justifyContent: "space-between" }}>
          <Typography variant="h6" color="primary">
            STLmaps
          </Typography>
          <CitySearch
            onCitySelect={(city) => {
              if (city) {
                // Only update bbox center, map center is handled by CitySearch component
                setBboxCenter(city.coordinates);
              }
            }}
          />
          <Box sx={{ width: SIDEBAR_WIDTH }} />{" "}
          {/* Spacer to balance the layout */}
        </Toolbar>
      </AppBar>

      {/* Sidebar */}
      <Drawer
        variant="permanent"
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
        
        <Tabs 
          value={activeTab} 
          onChange={(_, newValue) => setActiveTab(newValue)}
          variant="fullWidth"
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="Controls" />
          <Tab label="Layers" />
        </Tabs>
        
        {/* Controls Tab */}
        <Box 
          sx={{ 
            overflow: "auto", 
            p: 2, 
            display: activeTab === 0 ? 'block' : 'none',
            height: 'calc(100% - 48px)'
          }}
        >
          <BboxSelector
            geojsonRef={bboxRef}
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
          <Box sx={{ mt: 2 }}>
            <GenerateMeshButton
              bbox={bbox}
              setTerrainGeometry={setTerrainGeometry}
              setBuildingsGeometry={setBuildingsGeometry}
              setPolygonGeometries={setPolygonGeometries}
              vtLayers={vtLayers}
            />
          </Box>
          {terrainGeometry && (
            <ExportButtons
              terrainGeometry={terrainSettings.enabled ? terrainGeometry : null}
              buildingsGeometry={buildingSettings.enabled ? buildingsGeometry : null}
              polygonGeometries={polygonGeometries}
            />
          )}
          
          <Box sx={{ mt: 2 }}>
            <Button 
              variant="outlined" 
              onClick={() => setOpenAttribution(true)} 
              sx={{ mb: 1 }}
              color="secondary"
              fullWidth
            >
              Attribution
            </Button>
            <Button
              variant="outlined"
              onClick={() => setOpenTodoList(true)}
              color="secondary"
              fullWidth
            >
              Roadmap
            </Button>
          </Box>
          
          <AttributionDialog
            open={openAttribution}
            onClose={() => setOpenAttribution(false)}
          />
          <ProjectTodoList
            open={openTodoList}
            onClose={() => setOpenTodoList(false)}
          />
        </Box>
        
        {/* Layers Tab */}
        <Box 
          sx={{ 
            overflow: "auto", 
            display: activeTab === 1 ? 'block' : 'none',
            height: 'calc(100% - 48px)'
          }}
        >
          <LayerList />
        </Box>
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
            {(terrainGeometry || buildingsGeometry) && (
              <>
                {console.log("⚙️ Rendering ModelPreview with geometries:", {
                  terrainGeometry: !!terrainGeometry,
                  buildingsGeometry: !!buildingsGeometry,
                  polygonGeometries: polygonGeometries?.length || 0
                })}
                <ModelPreview
                  terrainGeometry={terrainSettings.enabled ? terrainGeometry : null}
                  buildingsGeometry={buildingSettings.enabled ? buildingsGeometry : null}
                  polygonGeometries={polygonGeometries}
                />
              </>
            )}
          </Suspense>
        </Box>
      </Box>
    </Box>
  );
};

export default App;
