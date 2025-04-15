import React from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Button,
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
import CitySearch from "./CitySearch";
import ExportButtons from "./ExportButtons";
import ProcessingIndicator from "./ProcessingIndicator";
import useLayerStore from "../stores/useLayerStore";

// View mode types
export type ViewMode = "split" | "map" | "model";

interface TopBarProps {
  viewMode: ViewMode;
  onViewModeChange: (event: React.MouseEvent<HTMLElement>, newMode: ViewMode | null) => void;
  onOpenAttribution: () => void;
  onOpenTodoList: () => void;
  onSidebarToggle: () => void;
  onMenuToggle: () => void;
  onCitySelect: (city: { coordinates: [number, number] } | null) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  viewMode,
  onViewModeChange,
  onOpenAttribution,
  onOpenTodoList,
  onSidebarToggle,
  onMenuToggle,
  onCitySelect,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { isProcessing, processingStatus, processingProgress } = useLayerStore();

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
              sx={{ mr: 2 }}
            >
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" color="primary">
            STLmaps
          </Typography>

          {/* View mode toggle buttons */}
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={onViewModeChange}
            aria-label="view mode"
            size="small"
            sx={{ ml: 2, bgcolor: 'background.paper', borderRadius: 1 }}
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
        {!isMobile && (
          <CitySearch
            onCitySelect={onCitySelect}
          />
        )}

        {/* Right side topbar buttons */}
        <Box sx={{ display: "flex", gap: 1 }}>
          {/* Export button - Always visible with just icon on mobile */}
          <ExportButtons />
          
          {/* Hamburger menu button - Only on mobile */}
          {isMobile && (
            <IconButton
              color="secondary"
              onClick={onMenuToggle}
            >
              <MenuIcon />
            </IconButton>
          )}

          {/* Desktop buttons */}
          {!isMobile && (
            <>
              <Button
                variant="outlined"
                onClick={onOpenAttribution}
                color="secondary"
              >
                Attribution
              </Button>
              <Button
                variant="outlined"
                onClick={onOpenTodoList}
                color="secondary"
              >
                Roadmap
              </Button>
              <ProcessingIndicator 
                isVisible={isProcessing}
                title="Processing 3D Model"
                progress={processingProgress}
                statusMessage={processingStatus}
                steps={[
                  { id: 'preparation', label: 'Preparing model data', status: isProcessing ? 'in-progress' : 'not-started', order: 0 },
                  { id: 'geometry', label: 'Building geometries', status: 'not-started', order: 5 },
                  { id: 'finalizing', label: 'Finalizing model', status: 'not-started', order: 100 },
                ]}
                activeStepId={isProcessing ? 'preparation' : null}
              />
            </>
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
};
