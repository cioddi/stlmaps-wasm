import React, { useState } from 'react';
import {
  Box,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
  Switch,
  Slider,
  Paper,
  Collapse,
  TextField,
  InputAdornment,
  FormControlLabel,
  Checkbox,
  Button,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import TerrainIcon from '@mui/icons-material/Terrain';
import WaterIcon from '@mui/icons-material/Water';
import ParkIcon from '@mui/icons-material/Park';
import ForestIcon from '@mui/icons-material/Forest';
import DirectionsIcon from '@mui/icons-material/Directions';
import LayersIcon from '@mui/icons-material/Layers';
import FormatColorFillIcon from '@mui/icons-material/FormatColorFill';
import BugReportIcon from '@mui/icons-material/BugReport';
import { useAppStore } from '../stores/useAppStore';
import { VertexDebugDialog } from './VertexDebugDialog';
import * as THREE from 'three';

// No props needed anymore as we'll use the Zustand store

const StyledPaper = styled(Paper)(({ theme }) => ({
  backgroundColor: theme.palette.background.paper,
  borderRadius: theme.shape.borderRadius,
  boxShadow: theme.shadows[1],
  margin: theme.spacing(0, 0, 2, 0),
  overflow: 'hidden',
}));

const LayerHeader = styled(ListItem, {
  shouldForwardProp: (prop) => prop !== 'active'
})<{ active?: boolean }>(({ theme, active }) => ({
  backgroundColor: active
    ? `${theme.palette.primary.main}10`
    : theme.palette.background.paper,
  borderLeft: `3px solid ${active ? theme.palette.primary.main : 'transparent'}`,
  transition: 'all 0.2s ease-in-out',
  '&:hover': {
    backgroundColor: `${theme.palette.primary.main}20`,
  },
}));

const ColorCircle = styled(Box)<{ bgcolor: string }>(({ bgcolor }) => ({
  width: 24,
  height: 24,
  borderRadius: '50%',
  backgroundColor: bgcolor,
  border: '2px solid white',
  boxShadow: '0 0 0 1px rgba(0,0,0,0.1)',
  display: 'inline-block',
  marginRight: 8,
}));


// Color is now stored as string in unified store, no conversion needed

const LayerList: React.FC = () => {
  // Get state and actions from the Zustand store
  const {
    vtLayers,
    terrainSettings,
    sceneGetter,
    toggleLayerEnabled,
    setLayerColor,
    setLayerExtrusionDepth,
    setLayerMinExtrusionDepth,
    setLayerZOffset,
    setLayerBufferSize,
    toggleLayerFixedBufferSize,
    toggleLayerUseAdaptiveScaleFactor,
    toggleLayerAlignVerticesToTerrain,
    toggleLayerApplyMedianHeight,
    setLayerHeightScaleFactor,
    setTerrainSettings,
  } = useAppStore();

  const [expandedLayers, setExpandedLayers] = useState<Record<string, boolean>>({
    terrain: false,
    buildings: true,
  });

  const [debugDialog, setDebugDialog] = useState<{
    open: boolean;
    layerName: string;
    layerMesh: THREE.Mesh | null;
    terrainMesh: THREE.Mesh | null;
  }>({
    open: false,
    layerName: '',
    layerMesh: null,
    terrainMesh: null
  });

  const handleLayerToggle = (index: number) => {
    toggleLayerEnabled(index);
  };

  const handleLayerColorChange = (index: number, hexColor: string) => {
    setLayerColor(index, hexColor);
  };

  const handleExtrusionChange = (index: number, value: number) => {
    setLayerExtrusionDepth(index, value);
  };

  const handleExtrusionToggle = (index: number, enabled: boolean) => {
    if (enabled) {
      setLayerExtrusionDepth(index, 1); // Default value when enabling
    } else {
      setLayerExtrusionDepth(index, undefined);
    }
  };

  const handleZOffsetChange = (index: number, value: number) => {
    setLayerZOffset(index, value);
  };

  const handleBufferSizeChange = (index: number, value: number) => {
    setLayerBufferSize(index, value);
  };

  const handleAdaptiveScaleFactorToggle = (index: number) => {
    toggleLayerUseAdaptiveScaleFactor(index);
  };

  const handleHeightScaleFactorChange = (index: number, value: number) => {
    setLayerHeightScaleFactor(index, value);
  };

  const handleMinExtrusionToggle = (index: number, enabled: boolean) => {
    if (enabled) {
      setLayerMinExtrusionDepth(index, 0); // Default value when enabling
    } else {
      setLayerMinExtrusionDepth(index, undefined);
    }
  };

  const handleMinExtrusionChange = (index: number, value: number) => {
    setLayerMinExtrusionDepth(index, value);
  };

  const toggleExpand = (layerId: string) => {
    setExpandedLayers(prev => ({
      ...prev,
      [layerId]: !prev[layerId]
    }));
  };

  const analyzeLayerVertices = (layerIndex: number) => {
    const layer = vtLayers[layerIndex];

    if (!layer) {
      return;
    }

    if (!sceneGetter) {
      return;
    }

    const scene = sceneGetter();
    if (!scene) {
      return;
    }

    // Find the layer mesh and terrain mesh in the scene
    let layerMesh: THREE.Mesh | null = null;
    let terrainMesh: THREE.Mesh | null = null;
    const meshes: Array<{ name: string; userData: any }> = [];

    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshes.push({ name: child.name, userData: child.userData });

        // Check if this is the layer mesh by matching userData properties
        const meshLabel = child.userData?.label;
        const meshSourceLayer = child.userData?.sourceLayer;

        if ((meshLabel && meshLabel === layer.label) ||
          (meshSourceLayer && meshSourceLayer === layer.sourceLayer) ||
          (meshLabel && meshLabel === layer.sourceLayer)) {
          layerMesh = child;
        }

        // Check if this is the terrain mesh
        if (child.name === 'terrain') {
          terrainMesh = child;
        }
      }
    });

    console.log('Debug mesh search:', {
      targetLayer: layer.label || layer.sourceLayer,
      targetSourceLayer: layer.sourceLayer,
      foundMeshes: meshes.map(m => ({
        name: m.name,
        userDataLabel: m.userData?.label,
        userDataSourceLayer: m.userData?.sourceLayer
      })),
      foundLayerMesh: !!layerMesh,
      foundTerrainMesh: !!terrainMesh
    });

    setDebugDialog({
      open: true,
      layerName: layer.label || layer.sourceLayer,
      layerMesh,
      terrainMesh
    });
  };

  const closeDebugDialog = () => {
    setDebugDialog(prev => ({ ...prev, open: false }));
  };

  const getLayerIcon = (sourceLayer: string, label?: string) => {
    // First try to match by label for better user experience
    if (label) {
      const lowerLabel = label.toLowerCase();
      if (lowerLabel.includes('water')) return <WaterIcon />;
      if (lowerLabel.includes('natural') || lowerLabel.includes('land use')) return <ForestIcon />;
      if (lowerLabel.includes('park') || lowerLabel.includes('recreation')) return <ParkIcon />;
      if (lowerLabel.includes('road') || lowerLabel.includes('street') || lowerLabel.includes('footway')) return <DirectionsIcon />;
      if (lowerLabel.includes('building')) return <LayersIcon />;
    }

    // Fall back to source layer matching
    switch (sourceLayer) {
      case 'water': return <WaterIcon />;
      case 'landcover':
      case 'landuse': return <ForestIcon />;
      case 'park': return <ParkIcon />;
      case 'transportation': return <DirectionsIcon />;
      default: return <LayersIcon />;
    }
  };

  return (
    <Box sx={{ width: '100%', maxHeight: '100%', overflowY: 'auto', px: 1 }}>
      {/* Terrain Layer */}
      <StyledPaper sx={{ marginTop: 2 }}>
        <LayerHeader active={terrainSettings.enabled} onClick={() => toggleExpand('terrain')}>
          <ListItemIcon>
            <TerrainIcon color={terrainSettings.enabled ? "primary" : "disabled"} />
          </ListItemIcon>
          <ListItemText primary="Terrain" />
          <FormControlLabel
            control={
              <Switch
                checked={terrainSettings.enabled}
                onChange={() => setTerrainSettings({
                  enabled: !terrainSettings.enabled
                })}
                onClick={(e) => e.stopPropagation()}
              />
            }
            label=""
          />
          {expandedLayers.terrain ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </LayerHeader>

        <Collapse in={expandedLayers.terrain} timeout="auto" unmountOnExit>
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <FormatColorFillIcon sx={{ mr: 1, color: terrainSettings.color }} />
              <TextField
                label="Terrain Color"
                type="color"
                value={terrainSettings.color}
                onChange={(e) => setTerrainSettings({
                  color: e.target.value
                })}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <ColorCircle bgcolor={terrainSettings.color} />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: '100%' }}
                size="small"
              />
            </Box>

            <Typography gutterBottom sx={{ mt: 2 }}>
              Vertical Exaggeration: {terrainSettings.verticalExaggeration.toFixed(2)}
            </Typography>
            <Slider
              value={terrainSettings.verticalExaggeration}
              onChange={(_, newValue) => setTerrainSettings({
                verticalExaggeration: newValue as number
              })}
              min={0.01}
              max={20.0}
              step={0.5}
              marks={[
                { value: 0.1, label: "0.1" },
                { value: 5, label: "5" },
                { value: 10, label: "10" },
              ]}
            />

            <Typography gutterBottom sx={{ mt: 2 }}>
              Base Height: {terrainSettings.baseHeight}
            </Typography>
            <Slider
              value={terrainSettings.baseHeight}
              onChange={(_, newValue) => setTerrainSettings({
                baseHeight: newValue as number
              })}
              min={-100}
              max={100}
              step={1}
              marks={[
                { value: -100, label: "-100" },
                { value: 0, label: "0" },
                { value: 100, label: "100" },
              ]}
            />

            <FormControlLabel
              sx={{ mt: 2 }}
              control={
                <Checkbox
                  checked={terrainSettings.simpleMesh}
                  onChange={(event) => setTerrainSettings({
                    simpleMesh: event.target.checked
                  })}
                />
              }
              label="Disable Raster DEM (simple block)"
            />
          </Box>
        </Collapse>
      </StyledPaper>

      {/* Vector Tile Layers */}
      {vtLayers.map((layer, index) => {
        const layerId = `layer-${index}-${layer.sourceLayer}`;
        const isExpanded = expandedLayers[layerId] || false;

        return (
          <StyledPaper key={layerId}>
            <LayerHeader
              active={layer.enabled}
              onClick={() => toggleExpand(layerId)}
            >
              <ListItemIcon>
                {getLayerIcon(layer.sourceLayer, layer.label)}
              </ListItemIcon>
              <ListItemText
                primary={layer.label || layer.sourceLayer.charAt(0).toUpperCase() + layer.sourceLayer.slice(1)}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={layer.enabled !== false}
                    onChange={() => handleLayerToggle(index)}
                    onClick={(e) => e.stopPropagation()}
                  />
                }
                label=""
              />
              {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </LayerHeader>

            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
              <Box sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <FormatColorFillIcon sx={{ mr: 1, color: layer.color }} />
                  <TextField
                    label="Color"
                    type="color"
                    value={layer.color}
                    onChange={(e) => handleLayerColorChange(index, e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <ColorCircle bgcolor={layer.color} />
                        </InputAdornment>
                      ),
                    }}
                    sx={{ width: '100%' }}
                    size="small"
                  />
                </Box>

                {/* Extrusion Depth with enable/disable checkbox */}
                <Box sx={{ mt: 2 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={layer.extrusionDepth !== undefined}
                        onChange={(e) => handleExtrusionToggle(index, e.target.checked)}
                        size="small"
                      />
                    }
                    label="Enable Extrusion Depth"
                  />

                  {layer.extrusionDepth !== undefined && (
                    <>
                      <Typography gutterBottom>
                        Extrusion Depth: {layer.extrusionDepth.toFixed(1)}
                      </Typography>
                      <Slider
                        value={layer.extrusionDepth}
                        onChange={(_, newValue) => handleExtrusionChange(index, newValue as number)}
                        min={0}
                        max={10}
                        step={0.1}
                        marks={[
                          { value: 0, label: "0" },
                          { value: 5, label: "5" },
                          { value: 10, label: "10" },
                        ]}
                      />
                    </>
                  )}
                </Box>

                {/* Min Extrusion Depth with enable/disable checkbox */}
                <Box sx={{ mt: 2 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={layer.minExtrusionDepth !== undefined}
                        onChange={(e) => handleMinExtrusionToggle(index, e.target.checked)}
                        size="small"
                      />
                    }
                    label="Enable Min Extrusion Depth"
                  />

                  {layer.minExtrusionDepth !== undefined && (
                    <>
                      <Typography gutterBottom>
                        Min Extrusion Depth: {layer.minExtrusionDepth.toFixed(1)}
                      </Typography>
                      <Slider
                        value={layer.minExtrusionDepth}
                        onChange={(_, newValue) => handleMinExtrusionChange(index, newValue as number)}
                        min={0}
                        max={10}
                        step={0.1}
                        marks={[
                          { value: 0, label: "0" },
                          { value: 5, label: "5" },
                          { value: 10, label: "10" },
                        ]}
                      />
                    </>
                  )}
                </Box>

                {layer.zOffset !== undefined && (
                  <Box sx={{ mt: 2 }}>
                    <Typography gutterBottom>
                      Z-Offset: {layer.zOffset.toFixed(1)}
                    </Typography>
                    <Slider
                      value={layer.zOffset}
                      onChange={(_, newValue) => handleZOffsetChange(index, newValue as number)}
                      min={-10}
                      max={10}
                      step={0.1}
                      marks={[
                        { value: -10, label: "-10" },
                        { value: 0, label: "0" },
                        { value: 10, label: "10" },
                      ]}
                    />
                  </Box>
                )}

                {layer.bufferSize !== undefined && (
                  <Box sx={{ mt: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography gutterBottom>
                        Buffer Size: {layer.bufferSize.toFixed(1)}
                      </Typography>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={layer.fixedBufferSize === true}
                            onChange={() => toggleLayerFixedBufferSize(index)}
                            size="small"
                          />
                        }
                        label="Fixed (Exact)"
                      />
                    </Box>
                    <Slider
                      value={layer.bufferSize}
                      onChange={(_, newValue) => handleBufferSizeChange(index, newValue as number)}
                      min={0}
                      max={10}
                      step={0.1}
                      marks={[
                        { value: 0, label: "0" },
                        { value: 5, label: "5" },
                        { value: 10, label: "10" },
                      ]}
                    />
                  </Box>
                )}

                {/* Adaptive Scale Factor */}
                <Box sx={{ mt: 2 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={layer.useAdaptiveScaleFactor === true}
                        onChange={() => handleAdaptiveScaleFactorToggle(index)}
                        size="small"
                      />
                    }
                    label="Use Adaptive Scale Factor"
                  />
                </Box>

                {/* Height Scale Factor */}
                <Box sx={{ mt: 2 }}>
                  <Typography gutterBottom>
                    Height Scale Factor: {(layer.heightScaleFactor || 1).toFixed(2)}
                  </Typography>
                  <Slider
                    value={layer.heightScaleFactor || 1}
                    onChange={(_, newValue) => handleHeightScaleFactorChange(index, newValue as number)}
                    min={0}
                    max={5}
                    step={0.1}
                    marks={[
                      { value: 0, label: "0" },
                      { value: 1, label: "1" },
                      { value: 2.5, label: "2.5" },
                      { value: 5, label: "5" },
                    ]}
                  />
                </Box>

                {/* Align Vertices to Terrain */}
                <Box sx={{ mt: 2 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={layer.alignVerticesToTerrain === true}
                        onChange={() => toggleLayerAlignVerticesToTerrain(index)}
                        size="small"
                      />
                    }
                    label="Align Vertices to Terrain"
                  />
                </Box>

                {/* Apply Median Height - only show for building layers */}
                {layer.sourceLayer === 'building' && (
                  <Box sx={{ mt: 2 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={layer.applyMedianHeight === true}
                          onChange={() => toggleLayerApplyMedianHeight(index)}
                          size="small"
                        />
                      }
                      label="Apply Median Height (fix buildings with height=5)"
                    />
                  </Box>
                )}

                {/* Debug Vertex Heights Button */}
                <Box sx={{ mt: 2 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<BugReportIcon />}
                    onClick={() => analyzeLayerVertices(index)}
                    fullWidth
                  >
                    Debug Vertex Heights
                  </Button>
                </Box>

              </Box>
            </Collapse>
          </StyledPaper>
        );
      })}

      {/* Debug Dialog */}
      <VertexDebugDialog
        open={debugDialog.open}
        onClose={closeDebugDialog}
        layerName={debugDialog.layerName}
        layerMesh={debugDialog.layerMesh}
        terrainMesh={debugDialog.terrainMesh}
      />

    </Box>
  );
};

export default LayerList;
