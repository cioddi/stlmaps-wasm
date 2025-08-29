import React from 'react';
import { 
  Box, 
  Typography, 
  Radio, 
  RadioGroup, 
  FormControlLabel, 
  FormControl, 
  FormLabel,
  Paper
} from '@mui/material';
import { useCombinedStore } from '../stores/useCombinedStore';

/**
 * Component that provides controls for adjusting the rendering quality/performance mode
 */
const RenderingControls: React.FC = () => {
  const { renderingSettings, setRenderingMode } = useCombinedStore();
  
  const handleModeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRenderingMode(event.target.value as 'quality' | 'performance');
  };

  return (
    <Paper elevation={2} sx={{ p: 2, mb: 2 }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6">Rendering Settings</Typography>
      </Box>

      <FormControl component="fieldset">
        <FormLabel component="legend">Rendering Mode</FormLabel>
        <RadioGroup
          value={renderingSettings.mode}
          onChange={handleModeChange}
          name="rendering-mode"
        >
          <FormControlLabel 
            value="quality" 
            control={<Radio />} 
            label={
              <Box>
                <Typography variant="body1">High Quality</Typography>
                <Typography variant="caption" color="text.secondary">
                  Beautiful shadows, reflections, and detailed materials. May slow down on less capable devices.
                </Typography>
              </Box>
            } 
          />
          <FormControlLabel 
            value="performance" 
            control={<Radio />} 
            label={
              <Box>
                <Typography variant="body1">Performance</Typography>
                <Typography variant="caption" color="text.secondary">
                  Simplified materials and lighting. Better for mobile devices and less powerful computers.
                </Typography>
              </Box>
            } 
          />
        </RadioGroup>
      </FormControl>
    </Paper>
  );
};

export default RenderingControls;
