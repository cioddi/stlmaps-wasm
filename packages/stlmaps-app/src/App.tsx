import React, { useState, useRef, Suspense } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Container,
  CssBaseline,
  CircularProgress,
  Box,
  Drawer,
  Divider,
  Paper,
} from "@mui/material";
import { MapLibreMap } from "@mapcomponents/react-maplibre";
import BboxSelector from "./components/BboxSelector";
import ModelPreview from "./components/ModelPreview";
import { GenerateMeshButton } from "./components/GenerateMeshButton";
import SetLocationButtons from "./components/SetLocationButtons";
import ExportButtons from "./components/ExportButtons";
import AttributionDialog from "./components/AttributionDialog";

const SIDEBAR_WIDTH = 240;

const App: React.FC = () => {
  const bboxRef = useRef<GeoJSON.Feature | undefined>(undefined);
  const [bbox, setBbox] = useState<GeoJSON.Feature | undefined>(undefined);
  const [polygonGeometries, setPolygonGeometries] =
    useState<THREE.BufferGeometry[] | null>(null);
  const [terrainGeometry, setTerrainGeometry] =
    useState<THREE.BufferGeometry | null>(null);
  const [buildingsGeometry, setBuildingsGeometry] =
    useState<THREE.BufferGeometry | null>(null);
  const [bboxCenter, setBboxCenter] = useState<[number, number]>([
    -74.00599999999997, 40.71279999999999,
  ]);
  const [mapCenter, setMapCenter] = useState<[number, number]>([
    -74.00599999999997, 40.71279999999999,
  ]);
  const [openAttribution, setOpenAttribution] = useState(false);

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 10000 }}
      >
        <Toolbar>
          <Typography variant="h6" color="primary">STLmaps</Typography>
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
        <Box sx={{ overflow: "auto", p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Controls
          </Typography>
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
              setBbox(geojson);
            }}
          />
          <Box sx={{ mt: 2 }}>
            <GenerateMeshButton
              bbox={bbox}
              setTerrainGeometry={setTerrainGeometry}
              setBuildingsGeometry={setBuildingsGeometry}
              setPolygonGeometries={setPolygonGeometries}
            />
          </Box>
          <SetLocationButtons
            setBboxCenter={setBboxCenter}
            setMapCenter={setMapCenter}
          />

          {terrainGeometry && (
            <ExportButtons
              terrainGeometry={terrainGeometry}
              buildingsGeometry={buildingsGeometry}
              polygonGeometries={polygonGeometries}
            />
          )}
          <Button variant="outlined" onClick={() => setOpenAttribution(true)}>
            Attribution
          </Button>
          <AttributionDialog
            open={openAttribution}
            onClose={() => setOpenAttribution(false)}
          />
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
              zoom: 16,
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
              <ModelPreview
                terrainGeometry={terrainGeometry}
                buildingsGeometry={buildingsGeometry}
                polygonGeometries={polygonGeometries}
              />
            )}
          </Suspense>
        </Box>
      </Box>
    </Box>
  );
};

export default App;
