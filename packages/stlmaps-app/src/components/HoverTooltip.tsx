import React from 'react';
import { Paper, Typography, Box } from '@mui/material';
import useLayerStore from '../stores/useLayerStore';

const HoverTooltip: React.FC = () => {
  const { hoverState } = useLayerStore();

  if (!hoverState.hoveredMesh || !hoverState.hoveredProperties || !hoverState.mousePosition) {
    return null;
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    left: hoverState.mousePosition.x + 10,
    top: hoverState.mousePosition.y - 10,
    zIndex: 1000,
    pointerEvents: 'none',
    maxWidth: '300px',
  };

  return (
    <Paper
      elevation={4}
      style={style}
      sx={{
        p: 2,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        color: 'white',
        fontSize: '0.875rem',
      }}
    >
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
        Feature Properties
      </Typography>
      <Box>
        {Object.entries(hoverState.hoveredProperties).map(([key, value]) => (
          <Box key={key} sx={{ mb: 0.5 }}>
            <Typography component="span" sx={{ fontWeight: 'bold', mr: 1 }}>
              {key}:
            </Typography>
            <Typography component="span">
              {value !== null && value !== undefined ? String(value) : 'N/A'}
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
};

export default HoverTooltip;
