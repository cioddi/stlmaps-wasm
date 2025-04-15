import React from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Divider,
    Paper,
    Chip,
    LinearProgress,
    useTheme,
} from "@mui/material";
import DoneOutlineIcon from "@mui/icons-material/DoneOutline";
import CodeIcon from "@mui/icons-material/Code";
import ScheduleIcon from "@mui/icons-material/Schedule";
import TimerIcon from "@mui/icons-material/Timer";

interface ProjectTodoListProps {
    open: boolean;
    onClose: () => void;
}

interface ChildTodoItem {
    title: string;
    done: boolean;
}

interface TodoItem {
    id: number;
    title: string;
    description: string;
    status: "completed" | "in-progress" | "planned";
    progress?: number;
    tags: string[];
    children?: ChildTodoItem[];
}

const ProjectTodoList: React.FC<ProjectTodoListProps> = ({ open, onClose }) => {
    const theme = useTheme();
    const [expandedItems, setExpandedItems] = React.useState<Record<number, boolean>>({});

    // Initialize expanded state when dialog opens based on task status
    React.useEffect(() => {
        if (open) {
            const initialExpandState: Record<number, boolean> = {};
            todoItems.forEach((item) => {
                // Only "in-progress" items are expanded by default
                initialExpandState[item.id] = item.status === "in-progress";
            });
            setExpandedItems(initialExpandState);
        }
    }, [open]);

    const toggleExpand = (id: number) => {
        setExpandedItems(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    const todoItems: TodoItem[] = [
        {
            id: 1,
            title: "3D Mesh Generation from Elevation Data",
            description:
                "Develop an algorithm to convert JAXA ALOS World 3D elevation data into navigable 3D terrain meshes.",
            status: "completed",
            tags: ["3D", "Algorithm", "Elevation"],
            progress: 100,
            children: [
                { title: "Process terrain height data", done: true },
                { title: "Convert to triangulated mesh", done: true },
                { title: "Optimize mesh for rendering", done: true }
            ]
        },
        {
            id: 2,
            title: "Vector Tile Integration for Geographic Data",
            description:
                "Convert various vector tile data sources into 3D mesh representations, including buildings, roads, land use, and other geographic features.",
            status: "in-progress",
            tags: ["OSM", "Vector Tiles", "3D Mesh"],
            progress: 65,
            children: [
                { title: "Load vector tile data", done: true },
                { title: "Generate 3D building extrusions", done: true },
                { title: "Add water polygons", done: true },
                { title: "Implement road networks (LineString support)", done: true },
                { title: "Add land use polygons", done: true },
                { title: "Support MapLibre style specification", done: false },
            ]
        },
        {
            id: 3,
            title: "@threegis/core npm package",
            description:
                "Create a custom npm package to handle 3D mesh generation and rendering.",
            status: "in-progress",
            tags: ["OSM", "Vector Tiles", "3D Mesh"],
            progress: 5,
            children: [
                { title: "Initialize monorepo using Lerna and Turborepo", done: true },
                { title: "Create GitHub actions for npm deployments", done: false },
                { title: "Set up stlmaps-app to consume the local dev version in development", done: false },
                { title: "Move processing and data-fetching functions from stlmaps-app to @threegis/core", done: false },
            ]
        },
        {
            id: 4,
            title: "Improve User Interface and Experience",
            description:
                "Enhance layer controls to allow users to customize the appearance of map elements.",
            status: "planned",
            tags: ["UI/UX", "Customization", "Styling"],
            progress: 0,
            children: [
                { title: "Improve mobile responsive UX", done: true },
                { title: "Implement layer controls (toggle, color, filter)", done: true },
                { title: "Add color and style options", done: true },
                { title: "Redesign layout", done: false },
                { title: "Add matrix support to ensure perfect alignment of adjacent bbox exports", done: false },
                { title: "Create save/load bbox presets", done: false },
                { title: "Create save/load style presets", done: false },
            ]
        },
    ];

    const getStatusIcon = (status: string) => {
        switch (status) {
            case "completed":
                return (
                    <DoneOutlineIcon
                        sx={{ color: theme.palette.success.main, fontSize: 28 }}
                    />
                );
            case "in-progress":
                return <CodeIcon sx={{ color: theme.palette.info.main, fontSize: 28 }} />;
            case "planned":
                return (
                    <ScheduleIcon
                        sx={{ color: theme.palette.warning.main, fontSize: 28 }}
                    />
                );
            default:
                return null;
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case "completed":
                return theme.palette.success.main;
            case "in-progress":
                return theme.palette.info.main;
            case "planned":
                return theme.palette.warning.main;
            default:
                return theme.palette.grey[500];
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case "completed":
                return "Completed";
            case "in-progress":
                return "In Progress";
            case "planned":
                return "Planned";
            default:
                return status;
        }
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            sx={{ zIndex: 10000 }}
            maxWidth="md"
            fullWidth
        >
            <DialogTitle
                sx={{
                    background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                    color: "white",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                }}
            >
                <Typography variant="h5" component="div" sx={{ fontWeight: "bold" }}>
                    Project Roadmap
                </Typography>
                <Chip
                    icon={<TimerIcon />}
                    label="Updated April 2025"
                    variant="outlined"
                    sx={{
                        bgcolor: 'rgba(255,255,255,0.2)',
                        color: 'white',
                        border: '1px solid rgba(255,255,255,0.5)'
                    }}
                />
            </DialogTitle>
            <DialogContent sx={{ py: 3 }}>
                <Typography variant="subtitle1" color="text.secondary" paragraph>
                    Track our progress and see what's coming next in the STL Maps project.
                    Here's what we're working on:
                </Typography>

                <List sx={{ width: "100%" }}>
                    {todoItems.map((item, index) => (
                        <React.Fragment key={item.id}>
                            {index > 0 && <Divider variant="inset" component="li" />}
                            <Paper
                                elevation={3}
                                sx={{
                                    my: 2,
                                    p: 0,
                                    overflow: "hidden",
                                    borderRadius: 2,
                                    border: `1px solid ${theme.palette.divider}`,
                                    transition: "transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out",
                                    "&:hover": {
                                        transform: "translateY(-4px)",
                                        boxShadow: 6,
                                    },
                                }}
                            >
                                <ListItem
                                    alignItems="flex-start"
                                    sx={{
                                        py: 2,
                                        px: 3,
                                        background: `linear-gradient(135deg, ${theme.palette.background.paper} 0%, ${theme.palette.background.paper} 85%, ${getStatusColor(
                                            item.status
                                        )}22 100%)`,
                                    }}
                                >
                                    <ListItemIcon sx={{ mt: 1.5 }}>
                                        {getStatusIcon(item.status)}
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={
                                            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                                                <Typography variant="h6" component="div">
                                                    {item.title}
                                                </Typography>
                                                <Chip
                                                    label={getStatusLabel(item.status)}
                                                    size="small"
                                                    sx={{
                                                        bgcolor: getStatusColor(item.status),
                                                        color: "white",
                                                        fontWeight: "bold",
                                                    }}
                                                />
                                            </Box>
                                        }
                                        secondary={
                                            <Box sx={{ color: "text.primary", mt: 1 }}>
                                                <Typography variant="body2" color="text.secondary" paragraph>
                                                    {item.description}
                                                </Typography>

                                                {item.progress !== undefined && (
                                                    <Box sx={{ mt: 1, mb: 2 }}>
                                                        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                                            <Typography variant="caption" color="text.secondary">
                                                                Progress
                                                            </Typography>
                                                            <Typography variant="caption" fontWeight="bold" color={getStatusColor(item.status)}>
                                                                {item.progress}%
                                                            </Typography>
                                                        </Box>
                                                        <LinearProgress
                                                            variant="determinate"
                                                            value={item.progress}
                                                            sx={{
                                                                height: 8,
                                                                borderRadius: 4,
                                                                bgcolor: theme.palette.grey[200],
                                                                '& .MuiLinearProgress-bar': {
                                                                    bgcolor: getStatusColor(item.status),
                                                                    borderRadius: 4,
                                                                }
                                                            }}
                                                        />
                                                    </Box>
                                                )}

                                                {item.children && item.children.length > 0 && (
                                                    <Box sx={{ mt: 2, mb: 2 }}>
                                                        <Box
                                                            onClick={() => toggleExpand(item.id)}
                                                            sx={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                cursor: 'pointer',
                                                                gap: 1,
                                                                mb: 1
                                                            }}
                                                        >
                                                            <Box sx={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                width: 18,
                                                                height: 18,
                                                                borderRadius: '50%',
                                                                bgcolor: `${getStatusColor(item.status)}22`,
                                                                color: getStatusColor(item.status),
                                                                fontSize: 14,
                                                                fontWeight: 'bold',
                                                                transition: 'transform 0.2s ease-in-out'
                                                            }}>
                                                                {expandedItems[item.id] ? '−' : '+'}
                                                            </Box>
                                                            <Typography
                                                                variant="caption"
                                                                color="text.secondary"
                                                                sx={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: 0.5
                                                                }}
                                                            >
                                                                Subtasks: {item.children.filter(child => child.done).length}/{item.children.length} completed
                                                            </Typography>
                                                        </Box>

                                                        {expandedItems[item.id] && (
                                                            <Box sx={{
                                                                pl: 1,
                                                                borderLeft: `2px solid ${theme.palette.grey[200]}`,
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                gap: 1
                                                            }}>
                                                                {item.children.map((child, idx) => (
                                                                    <Box
                                                                        key={idx}
                                                                        sx={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: 1
                                                                        }}
                                                                    >
                                                                        <Box
                                                                            sx={{
                                                                                width: 16,
                                                                                height: 16,
                                                                                borderRadius: '50%',
                                                                                border: `1px solid ${child.done ? theme.palette.success.main : theme.palette.grey[400]}`,
                                                                                bgcolor: child.done ? theme.palette.success.main : 'transparent',
                                                                                display: 'flex',
                                                                                justifyContent: 'center',
                                                                                alignItems: 'center'
                                                                            }}
                                                                        >
                                                                            {child.done && (
                                                                                <DoneOutlineIcon sx={{ color: 'white', fontSize: 12 }} />
                                                                            )}
                                                                        </Box>
                                                                        <Typography
                                                                            variant="body2"
                                                                            color={child.done ? "text.primary" : "text.secondary"}
                                                                            sx={{
                                                                                fontWeight: child.done ? 'medium' : 'normal'
                                                                            }}
                                                                        >
                                                                            {child.title}
                                                                        </Typography>
                                                                    </Box>
                                                                ))}
                                                            </Box>
                                                        )}
                                                    </Box>
                                                )}

                                                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.7, mt: 2 }}>
                                                    {item.tags.map((tag) => (
                                                        <Chip
                                                            key={tag}
                                                            label={tag}
                                                            size="small"
                                                            sx={{
                                                                bgcolor: `${getStatusColor(item.status)}22`,
                                                                borderColor: getStatusColor(item.status),
                                                                color: getStatusColor(item.status),
                                                                border: `1px solid ${getStatusColor(item.status)}`,
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

export default ProjectTodoList;
