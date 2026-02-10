import React from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import {
    ArrowUpward,
    ArrowDownward,
    ArrowBack,
    ArrowForward,
} from '@mui/icons-material';
import { useAppStore } from '../stores/useAppStore';
import { Feature, Polygon } from 'geojson';

const BboxShiftButtons: React.FC = () => {
    const { bbox, setBbox, setBboxCenter } = useAppStore();

    const handleShift = (direction: 'up' | 'down' | 'left' | 'right') => {
        if (!bbox || bbox.geometry.type !== 'Polygon') return;

        const coordinates = (bbox.geometry as Polygon).coordinates[0];
        if (!coordinates || coordinates.length < 4) return;

        // Calculate current bounds
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

        coordinates.forEach(coord => {
            minLng = Math.min(minLng, coord[0]);
            minLat = Math.min(minLat, coord[1]);
            maxLng = Math.max(maxLng, coord[0]);
            maxLat = Math.max(maxLat, coord[1]);
        });

        const width = maxLng - minLng;
        const height = maxLat - minLat;

        let shiftLng = 0;
        let shiftLat = 0;

        switch (direction) {
            case 'up':
                shiftLat = height;
                break;
            case 'down':
                shiftLat = -height;
                break;
            case 'left':
                shiftLng = -width;
                break;
            case 'right':
                shiftLng = width;
                break;
        }

        // Create new coordinates
        const newCoordinates = coordinates.map(coord => [
            coord[0] + shiftLng,
            coord[1] + shiftLat
        ]);

        // Create new center
        const newCenterX = (minLng + maxLng) / 2 + shiftLng;
        const newCenterY = (minLat + maxLat) / 2 + shiftLat;

        // Create new Feature
        const newBbox: Feature = {
            ...bbox,
            geometry: {
                ...bbox.geometry,
                coordinates: [newCoordinates]
            }
        };

        // Update store
        setBbox(newBbox);
        setBboxCenter([newCenterX, newCenterY]);
    };

    if (!bbox) return null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 2, mb: 1 }}>
            <Typography variant="caption" sx={{ mb: 1, color: 'text.secondary' }}>
                Result Selection Navigation
            </Typography>

            {/* Grid Layout for D-Pad feel */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5 }}>
                {/* Row 1 */}
                <Box />
                <Tooltip title="Shift Up">
                    <IconButton size="small" onClick={() => handleShift('up')} color="primary" sx={{ border: 1, borderColor: 'divider' }}>
                        <ArrowUpward fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Box />

                {/* Row 2 */}
                <Tooltip title="Shift Left">
                    <IconButton size="small" onClick={() => handleShift('left')} color="primary" sx={{ border: 1, borderColor: 'divider' }}>
                        <ArrowBack fontSize="small" />
                    </IconButton>
                </Tooltip>

                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {/* Center dot or icon could go here if needed, or empty */}
                </Box>

                <Tooltip title="Shift Right">
                    <IconButton size="small" onClick={() => handleShift('right')} color="primary" sx={{ border: 1, borderColor: 'divider' }}>
                        <ArrowForward fontSize="small" />
                    </IconButton>
                </Tooltip>

                {/* Row 3 */}
                <Box />
                <Tooltip title="Shift Down">
                    <IconButton size="small" onClick={() => handleShift('down')} color="primary" sx={{ border: 1, borderColor: 'divider' }}>
                        <ArrowDownward fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Box />
            </Box>
        </Box>
    );
};

export default BboxShiftButtons;
