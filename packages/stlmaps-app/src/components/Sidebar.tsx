import { useState } from "react";
import {
    Toolbar,
    Button,
    Box,
    Drawer,
    Tab,
    Tabs,
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

    return (
        <Drawer
            variant="permanent"
            sx={{
                width: SIDEBAR_WIDTH,
                flexShrink: 0,
                [`& .MuiDrawer-paper`]: {
                    width: SIDEBAR_WIDTH,
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
                <Tab label="Controls" />
                <Tab label="Layers" />
            </Tabs>

            {/* Controls Tab */}
            <Box
                sx={{
                    overflow: "auto",
                    p: 2,
                    display: activeTab === 0 ? 'block' : 'none',
                    height: 'calc(100% - 48px)'
                }}
            >
                <BboxSelector
                    options={{
                        center: bboxCenter,
                        scale: [1, 1],
                        rotate: 0,
                        orientation: "portrait",
                        width: 800,
                        height: 800,
                    }}
                    onChange={(geojson) => {
                        console.log("BboxSelector onChange triggered with:", geojson);
                        setBbox(geojson);
                    }}
                />
                <Box sx={{ mt: 2 }}>
                    <GenerateMeshButton />
                </Box>
                <ExportButtons
                />

                <Box sx={{ mt: 2 }}>
                    <Button
                        variant="outlined"
                        onClick={() => setOpenAttribution(true)}
                        sx={{ mb: 1 }}
                        color="secondary"
                        fullWidth
                    >
                        Attribution
                    </Button>
                    <Button
                        variant="outlined"
                        onClick={() => setOpenTodoList(true)}
                        color="secondary"
                        fullWidth
                    >
                        Roadmap
                    </Button>
                </Box>

                <AttributionDialog
                    open={openAttribution}
                    onClose={() => setOpenAttribution(false)}
                />
                <ProjectTodoList
                    open={openTodoList}
                    onClose={() => setOpenTodoList(false)}
                />
            </Box>

            {/* Layers Tab */}
            <Box
                sx={{
                    overflow: "auto",
                    display: activeTab === 1 ? 'block' : 'none',
                    height: 'calc(100% - 48px)'
                }}
            >
                <LayerList />
            </Box>
        </Drawer>
    );
};