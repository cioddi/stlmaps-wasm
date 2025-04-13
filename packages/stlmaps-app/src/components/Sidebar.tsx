import { useState } from "react";
import {
    Toolbar,
    Button,
    Box,
    Drawer,
    Tab,
    Tabs,
    useTheme,
    useMediaQuery,
} from "@mui/material";
import BboxSelector from "./BboxSelector";
import { GenerateMeshButton } from "./GenerateMeshButton";
import ExportButtons from "./ExportButtons";
import AttributionDialog from "./AttributionDialog";
import ProjectTodoList from "./ProjectTodoList";
import LayerList from "./LayerList";
import useLayerStore from "../stores/useLayerStore";

const SIDEBAR_WIDTH = 440;

export const Sidebar = ({ bboxCenter }: { bboxCenter: [number, number] }) => {
    const { terrainSettings, buildingSettings, vtLayers, bbox, setBbox } = useLayerStore();
    const [openAttribution, setOpenAttribution] = useState(false);
    const [openTodoList, setOpenTodoList] = useState(false);
    const [activeTab, setActiveTab] = useState(0);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    return (
        <>
        <Drawer
            variant="permanent"
            sx={{
                width: { xs: '100%', sm: SIDEBAR_WIDTH },
                flexShrink: 0,
                [`& .MuiDrawer-paper`]: {
                    width: { xs: '100%', sm: SIDEBAR_WIDTH },
                    boxSizing: "border-box",
                },
            }}
        >
            <Toolbar /> {/* Spacing below AppBar */}

            <Tabs
                value={activeTab}
                onChange={(_, newValue) => setActiveTab(newValue)}
                variant="fullWidth"
                sx={{ borderBottom: 1, borderColor: 'divider' }}
            >
                <Tab label="Layers" />
                <Tab label="Controls" />
            </Tabs>

            {/* Layers Tab */}
            <Box
                sx={{
                    overflow: "auto",
                    display: activeTab === 0 ? 'block' : 'none',
                    height: 'calc(100% - 48px)'
                }}
            >
                <LayerList />
            </Box>

            {/* Controls Tab */}
            <Box
                sx={{
                    overflow: "auto",
                    p: 2,
                    display: activeTab === 1 ? 'block' : 'none',
                    height: 'calc(100% - 48px)'
                }}
            >
                <Box sx={{ mt: 2 }}>
                </Box>
            </Box>
        </Drawer>
                </>
    );
};