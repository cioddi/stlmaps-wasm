import { useState, Suspense, RefObject, ChangeEvent } from "react";
import {
  Button,
  CircularProgress,
  Slider,
  Typography,
  Box,
} from "@mui/material";
import ModelPreview from "./ModelPreview";

// Define interfaces for our data structures
interface GridSize {
  width: number;
  height: number;
}

interface Tile {
  x: number;
  y: number;
  z: number;
}

interface TileData {
  imageData?: ImageData;
  width: number;
  height: number;
  x: number;
  y: number;
  z: number;
}

interface GeoJSONFeature {
  geometry: {
    type: string;
    coordinates: number[][][];
  };
  properties?: Record<string, any>;
  type: string;
}

interface ElevationProcessingResult {
  elevationGrid: number[][];
  gridSize: GridSize;
}

interface GenerateMeshButtonProps {
  bboxRef: RefObject<GeoJSONFeature>;
}

function GenerateMeshButton({ bboxRef }: GenerateMeshButtonProps) {
  const [downloadUrl, setDownloadUrl] = useState<string>("");
  const [objData, setObjData] = useState<string>("");
  const [previewOpen, setPreviewOpen] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [verticalExaggeration, setVerticalExaggeration] = useState<number>(0.00006);

  const generate3DModel = async (): Promise<void> => {
    if (!bboxRef.current) return;
    console.log("Generating 3D model for:", bboxRef.current);
    setGenerating(true);

    try {
      // Extract bbox coordinates from the feature
      const feature = bboxRef.current;
      
      if (!feature.geometry || feature.geometry.type !== 'Polygon') {
        console.error("Invalid geometry: expected a Polygon");
        setGenerating(false);
        return;
      }
      
      const coordinates = feature.geometry.coordinates[0]; // First ring of the polygon
      
      // Find min/max coordinates
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      coordinates.forEach((coord: number[]) => {
        const [lng, lat] = coord;
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
      });
      
      // Find appropriate zoom level where we get at most 4 tiles
      // Start with maximum supported zoom level (12)
      let zoom = 12;
      while (zoom > 0) {
        const tileCount = calculateTileCount(minLng, minLat, maxLng, maxLat, zoom);
        if (tileCount <= 4) break;
        zoom--;
      }
      
      console.log(`Using zoom level ${zoom} for the 3D model`);
      
      // Get tile coordinates
      const tiles = getTilesForBbox(minLng, minLat, maxLng, maxLat, zoom);
      console.log(`Downloading ${tiles.length} tiles`);
      
      // Download tile data
      const tileData = await Promise.all(
        tiles.map(tile => downloadTile(tile.z, tile.x, tile.y))
      );
      
      // Process elevation data to create a grid
      const { elevationGrid, gridSize } = processElevationData(tileData, tiles, minLng, minLat, maxLng, maxLat);
      
      // Generate OBJ model from elevation grid
      const objData = generateObjFromElevation(elevationGrid, gridSize, minLng, minLat, maxLng, maxLat);
      
      // Store obj data for preview
      setObjData(objData);
      
      // Create download
      const blob = new Blob([objData], { type: "text/plain" });
      setDownloadUrl(URL.createObjectURL(blob));
      console.log("3D model generated successfully");
      
      // Open the preview
      setPreviewOpen(true);
      
    } catch (error) {
      console.error("Error generating 3D model:", error);
    } finally {
      setGenerating(false);
    }
  };

  // Helper function to calculate the number of tiles at a given zoom level
  const calculateTileCount = (
    minLng: number, 
    minLat: number, 
    maxLng: number, 
    maxLat: number, 
    zoom: number
  ): number => {
    const minTile = lngLatToTile(minLng, minLat, zoom);
    const maxTile = lngLatToTile(maxLng, maxLat, zoom);
    
    const width = Math.abs(maxTile.x - minTile.x) + 1;
    const height = Math.abs(maxTile.y - minTile.y) + 1;
    
    return width * height;
  };

  // Convert lng/lat to tile coordinates
  const lngLatToTile = (
    lng: number, 
    lat: number, 
    zoom: number
  ): { x: number; y: number } => {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lng + 180) / 360 * n);
    
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    
    return { x, y };
  };

  // Get all tiles that cover the bounding box
  const getTilesForBbox = (
    minLng: number, 
    minLat: number, 
    maxLng: number, 
    maxLat: number, 
    zoom: number
  ): Tile[] => {
    const minTile = lngLatToTile(minLng, minLat, zoom);
    const maxTile = lngLatToTile(maxLng, maxLat, zoom);
    
    const tiles: Tile[] = [];
    
    for (let x = Math.min(minTile.x, maxTile.x); x <= Math.max(minTile.x, maxTile.x); x++) {
      for (let y = Math.min(minTile.y, maxTile.y); y <= Math.max(minTile.y, maxTile.y); y++) {
        tiles.push({ x, y, z: zoom });
      }
    }
    
    return tiles;
  };

  // Download a single tile from the WMTS service
  const downloadTile = async (
    z: number, 
    x: number, 
    y: number
  ): Promise<TileData> => {
    const url = `https://wms.wheregroup.com/dem_tileserver/raster_dem/${z}/${x}/${y}.webp`;
    
    console.log(`Downloading tile: ${url}`);
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download tile: ${response.status}`);
      }
      
      // Get the image as blob
      const blob = await response.blob();
      
      // Use image bitmap for processing
      const imageBitmap = await createImageBitmap(blob);
      
      // Create a canvas to read pixel data
      const canvas = document.createElement('canvas');
      canvas.width = imageBitmap.width;
      canvas.height = imageBitmap.height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');
      
      ctx.drawImage(imageBitmap, 0, 0);
      
      // Get the raw pixel data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      return {
        imageData,
        width: canvas.width,
        height: canvas.height,
        x,
        y,
        z
      };
    } catch (error) {
      console.error(`Error downloading tile ${z}/${x}/${y}:`, error);
      throw error;
    }
  };

  // Process the downloaded tiles to create an elevation grid
  const processElevationData = (
    tileData: TileData[], 
    tiles: Tile[], 
    minLng: number, 
    minLat: number, 
    maxLng: number, 
    maxLat: number
  ): ElevationProcessingResult => {
    // Define grid size for the final model
    const gridSize: GridSize = { width: 100, height: 100 };
    const elevationGrid: number[][] = new Array(gridSize.height).fill(0).map(() => 
      new Array(gridSize.width).fill(0)
    );
    
    // Process each tile to extract elevation data
    tileData.forEach(tile => {
      if (!tile.imageData) return;
      
      const { imageData, width, height, x: tileX, y: tileY, z: zoom } = tile;
      const data = imageData.data;
      
      // Calculate the tile bounds
      const n = Math.pow(2, zoom);
      const tileMinLng = (tileX / n * 360) - 180;
      const tileMaxLng = ((tileX + 1) / n * 360) - 180;
      
      const tileMaxLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / n))) * 180 / Math.PI;
      const tileMinLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tileY + 1) / n))) * 180 / Math.PI;
      
      // For each pixel in our output grid that falls within this tile
      for (let y = 0; y < gridSize.height; y++) {
        for (let x = 0; x < gridSize.width; x++) {
          // Calculate the lat/lng for this grid point
          const lng = minLng + (maxLng - minLng) * (x / (gridSize.width - 1));
          const lat = minLat + (maxLat - minLat) * (y / (gridSize.height - 1));
          
          // Check if this point is inside the current tile
          if (lng >= tileMinLng && lng <= tileMaxLng && lat >= tileMinLat && lat <= tileMaxLat) {
            // Convert lat/lng to pixel position in the tile
            const tilePixelX = Math.floor((lng - tileMinLng) / (tileMaxLng - tileMinLng) * (width - 1));
            const tilePixelY = Math.floor((lat - tileMinLat) / (tileMaxLat - tileMinLat) * (height - 1));
            
            // Get pixel index in the image data array
            const pixelIndex = (tilePixelY * width + tilePixelX) * 4;
            
            // Read RGB values
            const r = data[pixelIndex];
            const g = data[pixelIndex + 1];
            const b = data[pixelIndex + 2];
            
            // Decode elevation using Mapbox encoding
            // -10000 + ((r * 256 * 256 + g * 256 + b) * 0.1)
            const elevation = -10000 + ((r * 65536 + g * 256 + b) * 0.1);
            
            elevationGrid[y][x] = elevation;
          }
        }
      }
    });
    
    return { elevationGrid, gridSize };
  };

  // Generate an OBJ file from the elevation grid
  const generateObjFromElevation = (
    elevationGrid: number[][], 
    gridSize: GridSize, 
    minLng: number, 
    minLat: number, 
    maxLng: number, 
    maxLat: number
  ): string => {
    let objContent = "# OBJ file generated from elevation data\n";
    objContent += "# Bounds: " + [minLng, minLat, maxLng, maxLat].join(", ") + "\n";
    
    // Add vertices for top surface
    const { width, height } = gridSize;
    const scaleX = (maxLng - minLng) / (width - 1);
    const scaleY = (maxLat - minLat) / (height - 1);
    
    // Find min elevation for base
    let minElevation = Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        minElevation = Math.min(minElevation, elevationGrid[y][x]);
      }
    }
    
    // Set base elevation to be a fixed distance below the minimum elevation
    const baseOffset = 100; // meters below the minimum elevation
    const baseElevation = (minElevation - baseOffset) * verticalExaggeration;
    
    // Add top surface vertices
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const lng = minLng + x * scaleX;
        const lat = minLat + y * scaleY;
        const elevation = elevationGrid[y][x] * verticalExaggeration;
        
        // OBJ format: v x y z
        objContent += `v ${lng} ${lat} ${elevation}\n`;
      }
    }
    
    // Add bottom surface vertices
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const lng = minLng + x * scaleX;
        const lat = minLat + y * scaleY;
        
        // OBJ format: v x y z
        objContent += `v ${lng} ${lat} ${baseElevation}\n`;
      }
    }
    
    // Calculate total number of vertices per layer
    const verticesPerLayer = width * height;
    
    // Add faces for top surface
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const topLeft = y * width + x + 1;  // +1 because OBJ indices start at 1
        const topRight = topLeft + 1;
        const bottomLeft = (y + 1) * width + x + 1;
        const bottomRight = bottomLeft + 1;
        
        // Two triangles per grid cell for the top surface
        objContent += `f ${topLeft} ${bottomLeft} ${topRight}\n`;
        objContent += `f ${topRight} ${bottomLeft} ${bottomRight}\n`;
      }
    }
    
    // Add faces for bottom surface (inverted orientation)
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const topLeft = y * width + x + 1 + verticesPerLayer;
        const topRight = topLeft + 1;
        const bottomLeft = (y + 1) * width + x + 1 + verticesPerLayer;
        const bottomRight = bottomLeft + 1;
        
        // Two triangles per grid cell for the bottom (inverted)
        objContent += `f ${topLeft} ${topRight} ${bottomLeft}\n`;
        objContent += `f ${topRight} ${bottomRight} ${bottomLeft}\n`;
      }
    }
    
    // Add side walls
    // Front edge (y=0)
    for (let x = 0; x < width - 1; x++) {
      const topLeft = x + 1;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + verticesPerLayer;
      const bottomRight = topRight + verticesPerLayer;
      
      objContent += `f ${topLeft} ${topRight} ${bottomLeft}\n`;
      objContent += `f ${bottomLeft} ${topRight} ${bottomRight}\n`;
    }
    
    // Back edge (y=height-1)
    for (let x = 0; x < width - 1; x++) {
      const topLeft = (height - 1) * width + x + 1;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + verticesPerLayer;
      const bottomRight = topRight + verticesPerLayer;
      
      objContent += `f ${topLeft} ${bottomLeft} ${topRight}\n`;
      objContent += `f ${topRight} ${bottomLeft} ${bottomRight}\n`;
    }
    
    // Left edge (x=0)
    for (let y = 0; y < height - 1; y++) {
      const topLeft = y * width + 1;
      const bottomLeft = (y + 1) * width + 1;
      const topLeftBottom = topLeft + verticesPerLayer;
      const bottomLeftBottom = bottomLeft + verticesPerLayer;
      
      objContent += `f ${topLeft} ${topLeftBottom} ${bottomLeft}\n`;
      objContent += `f ${bottomLeft} ${topLeftBottom} ${bottomLeftBottom}\n`;
    }
    
    // Right edge (x=width-1)
    for (let y = 0; y < height - 1; y++) {
      const topRight = y * width + width;
      const bottomRight = (y + 1) * width + width;
      const topRightBottom = topRight + verticesPerLayer;
      const bottomRightBottom = bottomRight + verticesPerLayer;
      
      objContent += `f ${topRight} ${bottomRight} ${topRightBottom}\n`;
      objContent += `f ${topRightBottom} ${bottomRight} ${bottomRightBottom}\n`;
    }
    
    return objContent;
  };
  
  const handleExaggerationChange = (event: Event, newValue: number | number[]) => {
    setVerticalExaggeration(newValue as number);
  };
  
  return (
    <>
      <div style={{ 
        position: "absolute", 
        bottom: 20, 
        left: 20, 
        backgroundColor: "rgba(255,255,255,0.8)", 
        padding: "10px", 
        borderRadius: "4px",
        width: "300px" 
      }}>
        <Box sx={{ mb: 2 }}>
          <Typography id="vertical-exaggeration-slider" gutterBottom>
            Vertical Exaggeration: {verticalExaggeration.toFixed(6)}
          </Typography>
          <Slider
            value={verticalExaggeration}
            onChange={handleExaggerationChange}
            aria-labelledby="vertical-exaggeration-slider"
            min={0.000001}
            max={0.001}
            step={0.00001}
            marks={[
              { value: 0.000001, label: 'Min' },
              { value: 0.0001, label: 'Med' },
              { value: 0.001, label: 'Max' }
            ]}
          />
        </Box>
        <Button 
          variant="contained" 
          color="primary" 
          onClick={generate3DModel}
          disabled={generating}
        >
          {generating ? <CircularProgress size={24} /> : "Generate 3D Model"}
        </Button>
        {downloadUrl && (
          <>
            <Button
              variant="outlined"
              style={{ marginLeft: "1rem" }}
              onClick={() => setPreviewOpen(true)}
            >
              Preview
            </Button>
            <Button
              variant="outlined"
              style={{ marginLeft: "1rem" }}
              href={downloadUrl}
              download="model.obj"
            >
              Download OBJ
            </Button>
          </>
        )}
      </div>

      <Suspense fallback={null}>
        {objData && (
          <ModelPreview 
            objData={objData} 
            open={previewOpen} 
            onClose={() => setPreviewOpen(false)} 
          />
        )}
      </Suspense>
    </>
  );
}

export { GenerateMeshButton };
