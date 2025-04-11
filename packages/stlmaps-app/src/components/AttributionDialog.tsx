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
} from "@mui/material";

interface AttributionDialogProps {
  open: boolean;
  onClose: () => void;
}

const AttributionDialog: React.FC<AttributionDialogProps> = ({ open, onClose }) => {
  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      sx={{ zIndex: 10000 }}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>Acknowledgements</DialogTitle>
      <DialogContent dividers>
        {/* JAXA Attribution */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" gutterBottom>JAXA ALOS World 3D</Typography>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            <Box 
              component="img"
              src="assets/jaxa.svg" 
              alt="JAXA Logo"
              sx={{ width: 100, objectFit: 'contain' }}
            />
            <Box>
              <Typography variant="body1" paragraph>
                This application utilizes the Precise Global Digital 3D Map "ALOS World 3D" (AW3D) provided by the Japan Aerospace Exploration Agency (JAXA).
              </Typography>
              <Link
                href="https://earth.jaxa.jp/en/data/2552/index.html"
                target="_blank"
                rel="noopener noreferrer"
                underline="hover"
              >
                JAXA AW3D Dataset Information
              </Link>
            </Box>
          </Box>
        </Box>
        
        <Divider sx={{ my: 3 }} />
        
        {/* OpenStreetMap Attribution */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" gutterBottom>OpenStreetMap</Typography>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            <Box 
              component="img"
              src="assets/osm.svg" 
              alt="OpenStreetMap Logo"
              sx={{ width: 100, objectFit: 'contain' }}
            />
            <Box>
              <Typography variant="body1" paragraph>
                Map data is provided by OpenStreetMap contributors, serving as the foundation for the vector tile dataset used in this application. OpenStreetMap is an open collaborative project creating freely available geographic data.
              </Typography>
              <Link
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
                underline="hover"
              >
                © OpenStreetMap Contributors
              </Link>
            </Box>
          </Box>
        </Box>
        
        <Divider sx={{ my: 3 }} />
        
        {/* MapComponents Attribution */}
        <Box>
          <Typography variant="h6" gutterBottom>MapComponents</Typography>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            <Box 
              component="img"
              src="assets/mapcomponents.png" 
              alt="MapComponents Logo"
              sx={{ width: 100, objectFit: 'contain' }}
            />
            <Box>
              <Typography variant="body1" paragraph>
                This application is built using @mapcomponents/react-maplibre, a modern React framework for interactive map applications. MapComponents provides developer-friendly tools for creating customizable mapping solutions.
              </Typography>
              <Link
                href="https://mapcomponents.org"
                target="_blank"
                rel="noopener noreferrer"
                underline="hover"
              >
                MapComponents Project
              </Link>
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="outlined">Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default AttributionDialog;