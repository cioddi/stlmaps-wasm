import React, { useState, useRef, Suspense } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Container,
  CssBaseline,
  CircularProgress,
} from "@mui/material";
import { MapLibreMap } from "@mapcomponents/react-maplibre";
import BboxSelector from "./components/BboxSelector";
import ModelPreview from "./components/ModelPreview";
import { GenerateMeshButton } from "./components/GenerateMeshButton";

const App: React.FC = () => {
  const bboxRef = useRef<GeoJSON.Feature | undefined>(undefined);

  return (
    <>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6">3D Model App</Typography>
        </Toolbar>
      </AppBar>
      <Container style={{ height: "100vh", width: "100vw" }}>
        <MapLibreMap
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
          }}
          options={{
            center: [11.310180118044855, 47.55592195900479],
            zoom: 9,
            style:
              "https://wms.wheregroup.com/tileserver/style/osm-bright.json",
          }}
        />
        <BboxSelector
          geojsonRef={bboxRef}
          options={{
            center: [11.310180118044855, 47.55592195900479],
            scale: [1, 1],
            rotate: 0,
            orientation: "portrait",
            width: 40000,
            height: 40000,
          }}
        />
        <GenerateMeshButton bboxRef={bboxRef} />
      </Container>
    </>
  );
};

export default App;
