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

        {/* Processing Indicator - Self-contained component */}
        <ProcessingIndicator />
      </Toolbar>
    </AppBar>
  );
};
