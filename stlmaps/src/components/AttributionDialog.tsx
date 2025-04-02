import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
} from "@mui/material";

interface AttributionDialogProps {
  open: boolean;
  onClose: () => void;
}

const AttributionDialog: React.FC<AttributionDialogProps> = ({ open, onClose }) => {
  return (
    <Dialog open={open} onClose={onClose} sx={{ zIndex: 10000 }}>
      <DialogTitle>Acknowledgements</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body1" paragraph>
          Precise Global Digital 3D Map “ALOS World 3D” (AW3D) provided by JAXA.
        </Typography>
        <Typography variant="body2" color="primary">
          <a
            href="https://earth.jaxa.jp/en/data/2552/index.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://earth.jaxa.jp/en/data/2552/index.html
          </a>
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="outlined">Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default AttributionDialog;