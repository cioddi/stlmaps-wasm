import React from "react";
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Toolbar
} from "@mui/material";
import InfoIcon from "@mui/icons-material/Info";
import MapIcon from "@mui/icons-material/Map";
import CitySearch from "./CitySearch";

interface MobileMenuProps {
  open: boolean;
  onClose: () => void;
  onCitySelect: (city: { coordinates: [number, number] } | null) => void;
  onOpenAttribution: () => void;
  onOpenTodoList: () => void;
}

const MobileMenu: React.FC<MobileMenuProps> = ({
  open,
  onClose,
  onCitySelect,
  onOpenAttribution,
  onOpenTodoList
}) => {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      sx={{ zIndex: (theme) => theme.zIndex.drawer + 20000 }}
    >
      <Toolbar /> {/* Spacing below AppBar */}
      <Box
        sx={{ width: 280 }}
        role="presentation"
      >
        <List>
          <ListItem>
            <CitySearch
              onCitySelect={(city) => {
                if (city) {
                  onCitySelect(city);
                  onClose();
                }
              }}
            />
          </ListItem>
          <Divider />
          <ListItem onClick={() => {
            onOpenAttribution();
            onClose();
          }} sx={{ cursor: 'pointer' }}>
            <ListItemIcon>
              <InfoIcon />
            </ListItemIcon>
            <ListItemText primary="Attribution" />
          </ListItem>
          <ListItem onClick={() => {
            onOpenTodoList();
            onClose();
          }} sx={{ cursor: 'pointer' }}>
            <ListItemIcon>
              <MapIcon />
            </ListItemIcon>
            <ListItemText primary="Roadmap" />
          </ListItem>
        </List>
      </Box>
    </Drawer>
  );
};

export default MobileMenu;
