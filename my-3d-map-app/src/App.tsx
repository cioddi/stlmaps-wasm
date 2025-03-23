import React, { useState, useRef } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Container,
  CssBaseline,
} from "@mui/material";
import { MapLibreMap } from "@mapcomponents/react-maplibre";
import BboxSelector from "./components/BboxSelector";

const App: React.FC = () => {
  const bboxRef = useRef<GeoJSON.Feature | undefined>(undefined);
  const [downloadUrl, setDownloadUrl] = useState<string>("");

  const generate3DModel = async () => {
    if (!bboxRef.current) return;
    console.log(bboxRef.current);

    const mockOBJ = `# Mock OBJ
o bounding_box
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
`;

    const blob = new Blob([mockOBJ], { type: "text/plain" });
    setDownloadUrl(URL.createObjectURL(blob));
  };

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
            center: [13.404954, 52.520008],
            zoom: 14,
            style:
              "https://wms.wheregroup.com/tileserver/style/osm-bright.json",
          }}
        />
        <BboxSelector
          geojsonRef={bboxRef}
          options={{
            center: [13.404954, 52.520008],
            scale: [1, 1],
            rotate: 0,
            orientation: "portrait",
            width: 800,
            height: 800,
          }}
        />
        <div style={{ marginTop: "1rem" }}>
          <Button variant="contained" color="primary" onClick={generate3DModel}>
            Generate 3D Model
          </Button>
          {downloadUrl && (
            <Button
              variant="outlined"
              style={{ marginLeft: "1rem" }}
              href={downloadUrl}
              download="model.obj"
            >
              Download OBJ
            </Button>
          )}
        </div>
      </Container>
    </>
  );
};

export default App;
