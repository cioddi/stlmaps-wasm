import { useState } from "react";
import {
    Toolbar,
    Box,
    Drawer,
    Tab,
    Tabs,
} from "@mui/material";
import LayerList from "./LayerList";
import RenderingControls from "./RenderingControls";
import BboxShiftButtons from "./BboxShiftButtons";

const SIDEBAR_WIDTH = 340;

export const Sidebar = () => {
    const [activeTab, setActiveTab] = useState(0);

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
                    <BboxShiftButtons />
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
                        <RenderingControls />
                    </Box>
                </Box>
            </Drawer>
        </>
    );
};