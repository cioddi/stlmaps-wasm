import React from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  IconButton,
  useMediaQuery,
  useTheme,
  ToggleButtonGroup,
  ToggleButton,
  Tooltip,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import MapIcon from "@mui/icons-material/Map";
import ViewQuiltIcon from "@mui/icons-material/ViewQuilt";
import View3dIcon from "@mui/icons-material/ViewInAr";
import InfoIcon from "@mui/icons-material/Info";
import MilitaryTechIcon from '@mui/icons-material/MilitaryTech';
import CitySearch from "./CitySearch";
import ExportButtons from "./ExportButtons";
import ProcessingIndicator from "./ProcessingIndicator";
import { useAppStore } from "../stores/useAppStore";

// Define processing step type to match ProcessingIndicator
interface ProcessingStep {
  id: string;
  label: string;
  status: 'not-started' | 'in-progress' | 'completed';
  order: number;
}

// View mode types
export type ViewMode = "split" | "map" | "model";

interface TopBarProps {
  viewMode: ViewMode;
  onViewModeChange: (
    event: React.MouseEvent<HTMLElement>,
    newMode: ViewMode | null
  ) => void;
  onOpenAttribution: () => void;
  onOpenInfo: () => void;
  onOpenTodoList: () => void;
  onSidebarToggle: () => void;
  onMenuToggle: () => void;
  onCitySelect: (city: { coordinates: [number, number] } | null) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  viewMode,
  onViewModeChange,
  onOpenAttribution,
  onOpenInfo,
  onOpenTodoList,
  onSidebarToggle,
  onMenuToggle,
  onCitySelect,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const { isProcessing, processingStatus, processingProgress, vtLayers } =
    useAppStore();

  // Create dynamic processing steps based on current progress
  const getProcessingSteps = (): ProcessingStep[] => {
    const steps: ProcessingStep[] = [];
    
    // Initial terrain/elevation processing (0-50% progress)
    const terrainStatus = 
      !processingProgress ? 'not-started' :
      processingProgress < 50 ? 'in-progress' : 'completed';
    
    steps.push({
      id: "terrain",
      label: "Processing terrain and elevation data",
      status: terrainStatus,
      order: 0,
    });
    
    // Vector processing step (50-90% progress)  
    const vectorProcessingStatus = 
      !processingProgress || processingProgress < 50 ? 'not-started' :
      processingProgress < 90 ? 'in-progress' : 'completed';
    
    steps.push({
      id: 'vector-processing',
      label: 'Processing vector data',
      status: vectorProcessingStatus,
      order: 1,
    });
    
    // Note: Removed finalization step to show only 2 main steps
    
    return steps;
  };

  // Determine active step based on current processing status
  const getActiveStepId = (): string | null => {
    if (!isProcessing || !processingProgress) return null;
    
    if (processingProgress < 50) return "terrain";
    if (processingProgress < 90) {
      // Find which layer is currently being processed
      const layerIndex = Math.floor((processingProgress - 50) / (40 / vtLayers.length));
      const clampedIndex = Math.min(layerIndex, vtLayers.length - 1);
      return `layer-${vtLayers[clampedIndex]?.sourceLayer}`;
    }
    return "finalization";
  };

  return (
    <AppBar
      position="fixed"
      sx={{ zIndex: (theme) => theme.zIndex.drawer + 10000 }}
    >
      <Toolbar sx={{ display: "flex", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center" }}>
          {isMobile && (
            <IconButton
              color="secondary"
              edge="start"
              onClick={onSidebarToggle}
            >
              <MenuIcon />
            </IconButton>
          )}
          <img src="assets/logo.png" alt="Logo" width={isMobile ? 30 : 30} />
          <Typography
            variant={isMobile ? "body2" : "h6"}
            color="primary"
            sx={{
              fontSize: isMobile ? "0.75rem" : undefined,
              fontWeight: "bold",
              marginTop: "5px"
            }}
          >
            STLMaps
          </Typography>

          {/* View mode toggle buttons */}
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={onViewModeChange}
            aria-label="view mode"
            size="small"
            sx={{ ml: 2, bgcolor: "background.paper", borderRadius: 1 }}
          >
            <Tooltip title="Map Only">
              <ToggleButton value="map" aria-label="map only">
                <MapIcon />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Split View">
              <ToggleButton value="split" aria-label="split view">
                <ViewQuiltIcon />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="3D Model Only">
              <ToggleButton value="model" aria-label="model only">
                <View3dIcon />
              </ToggleButton>
            </Tooltip>
          </ToggleButtonGroup>
        </Box>

        {/* Middle section - Only visible on desktop */}
        {!isMobile && <CitySearch onCitySelect={onCitySelect} />}

        {/* Right side topbar buttons */}
        <Box sx={{ display: "flex" }}>
          {/* Export button - Always visible with just icon on mobile */}
          <ExportButtons />

          {/* Hamburger menu button - Only on mobile */}
          {isMobile && (
            <IconButton color="secondary" onClick={onMenuToggle}>
              <MenuIcon />
            </IconButton>
          )}

          {/* Desktop buttons */}
          {!isMobile && (
            <>
              <Tooltip title="About">
                <IconButton
                  color="secondary"
                  onClick={onOpenInfo}
                  sx={{ ml: 1 }}
                >
                  <InfoIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Attribution">
                <IconButton
                  color="secondary"
                  onClick={onOpenAttribution}
                  sx={{ ml: 1 }}
                >
                  <MilitaryTechIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Roadmap">
                <IconButton
                  color="secondary"
                  onClick={onOpenTodoList}
                  sx={{ ml: 1 }}
                >
                  <MapIcon />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Box>

        {/* Processing Indicator - Always visible, positioned differently based on device */}
        <ProcessingIndicator
          isVisible={isProcessing}
          title="Processing 3D Model"
          progress={processingProgress}
          statusMessage={processingStatus}
          steps={getProcessingSteps()}
          activeStepId={getActiveStepId()}
        />
      </Toolbar>
    </AppBar>
  );
};
