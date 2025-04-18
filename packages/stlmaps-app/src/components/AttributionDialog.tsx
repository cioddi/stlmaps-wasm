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
  List,
  ListItem,
  ListItemText,
  Chip,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import PublicIcon from "@mui/icons-material/Public";
import SatelliteIcon from "@mui/icons-material/Satellite";
import MapIcon from "@mui/icons-material/Map";
import CodeIcon from "@mui/icons-material/Code";
import ServiceIcon from "@mui/icons-material/SettingsInputComponent";

interface AttributionDialogProps {
  open: boolean;
  onClose: () => void;
}

interface AttributionItem {
  id: number;
  title: string;
  description: string;
  icon: "satellite" | "map" | "public" | "code" | "service";
  logoSrc: string;
  logoAlt: string;
  linkText: string;
  linkUrl: string;
  tags: string[];
}

// Attribution data object for easy management and expansion
const attributionItems: AttributionItem[] = [
  {
    id: 1,
    title: "JAXA ALOS World 3D",
    description:
      'This application utilizes the Precise Global Digital 3D Map "ALOS World 3D" (AW3D) provided by the Japan Aerospace Exploration Agency (JAXA).',
    icon: "satellite",
    logoSrc: "/assets/jaxa.svg",
    logoAlt: "JAXA Logo",
    linkText: "JAXA AW3D Dataset Information",
    linkUrl: "https://earth.jaxa.jp/en/data/2552/index.html",
    tags: ["Data Source", "Terrain", "3D"],
  },
  {
    id: 2,
    title: "OpenStreetMap",
    description:
      "Map data is provided by OpenStreetMap contributors, serving as the foundation for the vector tile dataset used in this application. OpenStreetMap is an open collaborative project creating freely available geographic data.",
    icon: "map",
    logoSrc: "/assets/osm.svg",
    logoAlt: "OpenStreetMap Logo",
    linkText: "© OpenStreetMap Contributors",
    linkUrl: "https://www.openstreetmap.org/copyright",
    tags: ["Data Source", "Vector", "Community"],
  },
  {
    id: 3,
    title: "MapComponents",
    description:
      "This application is built using @mapcomponents/react-maplibre, a modern React framework for interactive map applications. MapComponents provides developer-friendly tools for creating customizable mapping solutions.",
    icon: "code",
    logoSrc: "/assets/mapcomponents.png",
    logoAlt: "MapComponents Logo",
    linkText: "MapComponents Project",
    linkUrl: "https://mapcomponents.org",
    tags: ["Framework", "React", "Maps"],
  },
];

const AttributionDialog: React.FC<AttributionDialogProps> = ({
  open,
  onClose,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isTablet = useMediaQuery(theme.breakpoints.down("md"));

  const getIconByType = (iconType: string) => {
    switch (iconType) {
      case "service":
        return (
          <ServiceIcon
            sx={{ color: theme.palette.primary.main, fontSize: 28 }}
          />
        );
      case "code":
        return (
          <CodeIcon
            sx={{ color: theme.palette.primary.main, fontSize: 28 }}
          />
        );
      case "satellite":
        return (
          <SatelliteIcon
            sx={{ color: theme.palette.primary.main, fontSize: 28 }}
          />
        );
      case "map":
        return (
          <MapIcon sx={{ color: theme.palette.secondary.main, fontSize: 28 }} />
        );
      case "public":
        return (
          <PublicIcon sx={{ color: theme.palette.info.main, fontSize: 28 }} />
        );
      default:
        return null;
    }
  };

  const getIconColor = (iconType: string) => {
    switch (iconType) {
      case "satellite":
        return theme.palette.primary.main;
      case "map":
        return theme.palette.secondary.main;
      case "public":
        return theme.palette.info.main;
      default:
        return theme.palette.grey[500];
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      sx={{ zIndex: 10000 }}
      maxWidth="md"
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
            src="assets/panda.png"
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
            Acknowledgements
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ py: 3 }}>
        <Typography
          variant={isMobile ? "body1" : "subtitle1"}
          color="text.secondary"
          component={"p"}
          sx={{ py: 3 }}
        >
          STL Maps is built upon the work of amazing organizations and
          open-source projects. Here are the key contributors that make this
          application possible:
        </Typography>

        <List sx={{ width: "100%", padding: isMobile ? 0 : 1 }}>
          {attributionItems.map((item, index) => (
            <React.Fragment key={item.id}>
              {index > 0 && <Divider variant="inset" component="li" />}
              <Paper
                elevation={3}
                sx={{
                  my: isMobile ? 1 : 2,
                  p: 0,
                  overflow: "hidden",
                  borderRadius: 2,
                  border: `1px solid ${theme.palette.divider}`,
                  transition:
                    "transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out",
                  "&:hover": {
                    transform: isMobile ? "none" : "translateY(-4px)",
                    boxShadow: isMobile ? 3 : 6,
                  },
                }}
              >
                <ListItem
                  alignItems="flex-start"
                  sx={{
                    py: isMobile ? 1.5 : 2,
                    px: isMobile ? 2 : 3,
                    background: `linear-gradient(135deg, ${theme.palette.background.paper} 0%, ${theme.palette.background.paper} 85%, ${getIconColor(
                      item.icon
                    )}22 100%)`,
                    flexDirection: isMobile ? "column" : "row",
                  }}
                >
                  {!isMobile && (
                    <Box sx={{ mt: 1.5, minWidth: 56 }}>
                      {getIconByType(item.icon)}
                    </Box>
                  )}
                  <ListItemText
                    primary={
                      <Box
                        sx={{
                          display: "flex",
                          flexDirection: isMobile ? "column" : "row",
                          justifyContent: "space-between",
                          alignItems: isMobile ? "flex-start" : "center",
                          mb: 1,
                          gap: isMobile ? 1 : 0,
                        }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            width: isMobile ? "100%" : "auto",
                          }}
                        >
                          {isMobile && (
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                minWidth: 24,
                              }}
                            >
                              {getIconByType(item.icon)}
                            </Box>
                          )}
                          <Typography
                            variant={isMobile ? "subtitle1" : "h6"}
                            component="div"
                            sx={{
                              fontWeight: isMobile ? "medium" : "bold",
                              wordBreak: "break-word",
                            }}
                          >
                            {item.title}
                          </Typography>
                        </Box>
                      </Box>
                    }
                    secondary={
                      <Box
                        sx={{ color: "text.primary", mt: isMobile ? 0.5 : 1 }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 2,
                            mb: 2,
                          }}
                        >
                          <Box
                            component="img"
                            src={item.logoSrc}
                            alt={item.logoAlt}
                            sx={{
                              width: isMobile ? 70 : 100,
                              height: isMobile ? 70 : 100,
                              objectFit: "contain",
                              flexShrink: 0,
                              border: `1px solid ${theme.palette.divider}`,
                              p: 1,
                              borderRadius: 1,
                              bgcolor: "background.paper",
                            }}
                          />
                          <Box>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              paragraph
                              sx={{
                                fontSize: isMobile ? "0.8rem" : "0.875rem",
                                mb: isMobile ? 1 : 1.5,
                              }}
                            >
                              {item.description}
                            </Typography>
                            <Link
                              href={item.linkUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              underline="hover"
                              sx={{
                                color: getIconColor(item.icon),
                                fontWeight: "medium",
                                fontSize: isMobile ? "0.8rem" : "0.875rem",
                              }}
                            >
                              {item.linkText}
                            </Link>
                          </Box>
                        </Box>

                        <Box
                          sx={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 0.7,
                            mt: 2,
                          }}
                        >
                          {item.tags.map((tag) => (
                            <Chip
                              key={tag}
                              label={tag}
                              size="small"
                              sx={{
                                bgcolor: `${getIconColor(item.icon)}22`,
                                borderColor: getIconColor(item.icon),
                                color: getIconColor(item.icon),
                                border: `1px solid ${getIconColor(item.icon)}`,
                              }}
                            />
                          ))}
                        </Box>
                      </Box>
                    }
                  />
                </ListItem>
              </Paper>
            </React.Fragment>
          ))}
        </List>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: theme.palette.grey[50] }}>
        <Button onClick={onClose} variant="outlined">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AttributionDialog;
