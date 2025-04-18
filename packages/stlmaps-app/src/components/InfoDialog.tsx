import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Divider,
  Link,
  Paper,
  Grid,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import TerrainIcon from "@mui/icons-material/Terrain";
import GridOnIcon from "@mui/icons-material/GridOn";
import ParkIcon from "@mui/icons-material/Park";
import DirectionsIcon from "@mui/icons-material/Directions";
import BusinessIcon from "@mui/icons-material/Business";

interface InfoDialogProps {
  open: boolean;
  onClose: () => void;
}

interface ProcessItem {
  id: number;
  title: string;
  description: string;
  icon: React.ReactNode;
  imageSrc: string;
  imageAlt: string;
}

const InfoDialog: React.FC<InfoDialogProps> = ({ open, onClose }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isTablet = useMediaQuery(theme.breakpoints.down("md"));

  // Process explanation items
  const processItems: ProcessItem[] = [
    {
      id: 1,
      title: "Terrain Generation",
      description:
        "Downloads Raster-DEM tiles and uses them to create the base terrain mesh, providing the topographical foundation for the 3D model.",
      icon: <TerrainIcon sx={{ color: theme.palette.primary.main, fontSize: 28 }} />,
      imageSrc: "assets/process_terrain.png",
      imageAlt: "Terrain mesh generation process",
    },
    {
      id: 2,
      title: "Vector Tile Acquisition",
      description:
        "Downloads all vector tiles from zoom level 14 that intersect with the selected bounding box, providing detailed geographic data.",
      icon: <GridOnIcon sx={{ color: theme.palette.primary.main, fontSize: 28 }} />,
      imageSrc: "assets/process_vt.png",
      imageAlt: "Vector tile downloading process",
    },
    {
      id: 3,
      title: "Space Creation",
      description:
        "Extracts water, landuse, landcover and parks from vector tiles and creates extruded 3D meshes to represent these areas in the model.",
      icon: <ParkIcon sx={{ color: theme.palette.secondary.main, fontSize: 28 }} />,
      imageSrc: "assets/process_polygon_layers.png",
      imageAlt: "Green space and park mesh creation",
    },
    {
      id: 4,
      title: "Street Generation",
      description:
        "Buffers street LineStrings and extrudes the resulting polygons, creating 3D representations of roads and streets.",
      icon: <DirectionsIcon sx={{ color: theme.palette.secondary.main, fontSize: 28 }} />,
      imageSrc: "assets/process_streets.png",
      imageAlt: "Street buffering and extrusion process",
    },
    {
      id: 5,
      title: "Building Construction",
      description:
        "Creates building polygons using the height property from the geometries of the buildings vector-tile source-layer.",
      icon: <BusinessIcon sx={{ color: theme.palette.info.main, fontSize: 28 }} />,
      imageSrc: "assets/process_buildings.png",
      imageAlt: "Building polygon creation process",
    },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      sx={{ zIndex: 10000 }}
      maxWidth="lg"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle
        sx={{
          background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
          color: "white",
          padding: isMobile ? 2 : 3,
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          alignItems: "center",
          gap: 2,
        }}
        component={"div"}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: isMobile ? "center" : "flex-start",
            width: "100%",
          }}
        >
          <img
            src="assets/fox.png"
            alt="Panda with a 3D map blocks"
            style={{
              width: isMobile ? "78px" : "82px",
              height: isMobile ? "78px" : "82px",
              borderRadius: "50%",
              marginRight: "12px",
              boxShadow: "0px 2px 4px rgba(0,0,0,0.25)",
              border: "2px solid white",
              objectFit: "cover",
            }}
          />
          <Typography
            variant={isMobile ? "h6" : "h5"}
            component="div"
            sx={{
              fontWeight: "bold",
            }}
          >
            About STL Maps
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ py: 3 }}>
        <Paper
          elevation={2}
          sx={{ mT: 10,p: 3, mb: 4, borderRadius: 2, backgroundColor: theme.palette.background.paper }}
        >
          <Typography variant="body1" paragraph>
            This website offers a free tool to generate 3D models of map areas — directly in your browser.
          </Typography>
          
          <Typography variant="body1" paragraph>
            By simply dragging or resizing a bounding box over the map, you can define the area of interest. Once selected, the app retrieves elevation data from a raster DEM and downloads up to 9 vector tiles at zoom level 14 that intersect with the area. Using this data, it generates detailed 3D meshes representing buildings, roads, water bodies, parks, and land use features.
          </Typography>
          
          <Typography variant="body1" paragraph>
            A layer tree in the left sidebar lets you configure how different layers are rendered, giving you full control over the model's appearance. At the bottom of the page, you'll find a live 3D preview that updates as you adjust the area or settings.
          </Typography>
          
          <Typography variant="body1" paragraph>
            Once the model is generated, you can export it in multiple formats:
          </Typography>
          
          <Box sx={{ pl: 2, mb: 2 }}>
            <Typography variant="body1" component="div">
              • <strong>OBJ</strong>: A widely used format for 3D modeling.
            </Typography>
            <Typography variant="body1" component="div">
              • <strong>STL</strong>: Perfect for 3D printing.
            </Typography>
            <Typography variant="body1" component="div">
              • <strong>GLB</strong>: A modern, compact format that includes different layers as separate geometries. This allows for color customization in 3D printing slicers, like selecting different colors for buildings, roads, and parks when converting to <strong>3MF</strong> for 3D printing.
            </Typography>
          </Box>
          
          <Typography variant="body1" paragraph>
            For <strong>GLB to 3MF</strong> conversion, we recommend using an online service like <Link href="https://convertio.co/glb-3mf/" target="_blank" rel="noopener noreferrer">Convertio</Link>, which provides a simple way to convert GLB files to the 3MF format for 3D printing.
          </Typography>

          <Typography variant="body1" paragraph>
            The app uses raster & vector-tiles provided by <a href="https://www.wheregroup.com">WhereGroup GmbH</a>.
          </Typography>
          
          <Typography variant="body1" paragraph>
            Everything else is handled locally in your browser.
          </Typography>
        </Paper>

        <Divider sx={{ my: 4 }} />
        
        <Typography
          variant="h6"
          component="h2"
          sx={{ mb: 3, fontWeight: "bold", color: theme.palette.primary.main }}
        >
          How It Works
        </Typography>
        
        <Grid container spacing={3}>
          {processItems.map((item) => (
            <Grid item xs={12} md={6} key={item.id}>
              <Paper
                elevation={3}
                sx={{
                  p: 0,
                  overflow: "hidden",
                  borderRadius: 2,
                  height: "100%",
                  border: `1px solid ${theme.palette.divider}`,
                  transition: "transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out",
                  "&:hover": {
                    transform: isMobile ? "none" : "translateY(-4px)",
                    boxShadow: isMobile ? 3 : 6,
                  },
                }}
              >
                <Box
                  sx={{
                    p: 2,
                    backgroundColor: theme.palette.grey[50],
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                  }}
                >
                  <Box>{item.icon}</Box>
                  <Typography variant="h6" component="h3" fontWeight="bold">
                    {item.title}
                  </Typography>
                </Box>
                
                <Box sx={{ p: 2 }}>
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: { xs: "column", sm: "row" },
                      gap: 2,
                      mb: 2,
                    }}
                  >
                    <Box
                      component="img"
                      src={item.imageSrc}
                      alt={item.imageAlt}
                      sx={{
                        width: { xs: "100%", sm: 150 },
                        height: { xs: 200, sm: 150 },
                        objectFit: "contain",
                        border: `1px solid ${theme.palette.divider}`,
                        borderRadius: 1,
                        backgroundColor: "white",
                        p: 1,
                      }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {item.description}
                    </Typography>
                  </Box>
                </Box>
              </Paper>
            </Grid>
          ))}
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: theme.palette.grey[50] }}>
        <Button onClick={onClose} variant="outlined">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default InfoDialog;
