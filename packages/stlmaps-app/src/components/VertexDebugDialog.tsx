import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
  Alert,
  Box,
  Paper
} from '@mui/material';
import * as THREE from 'three';

interface VertexData {
  vertexId: number;
  x: number;
  y: number;
  layerZ: number;
  terrainZ: number;
  difference: number;
}

interface VertexDebugDialogProps {
  open: boolean;
  onClose: () => void;
  layerName: string;
  layerMesh: THREE.Mesh | null;
  terrainMesh: THREE.Mesh | null;
}

export const VertexDebugDialog: React.FC<VertexDebugDialogProps> = ({
  open,
  onClose,
  layerName,
  layerMesh,
  terrainMesh
}) => {
  const [vertexData, setVertexData] = useState<VertexData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Analyze vertices when dialog opens or data changes
  React.useEffect(() => {
    if (!open || !layerMesh || !terrainMesh) {
      setVertexData([]);
      setError(null);
      return;
    }

    analyzeVertices();
  }, [open, layerMesh, terrainMesh]);

  const analyzeVertices = async () => {
    if (!layerMesh || !terrainMesh) {
      setError('Missing mesh data');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const layerGeometry = layerMesh.geometry;
      const terrainGeometry = terrainMesh.geometry;

      if (!layerGeometry.attributes.position || !terrainGeometry.attributes.position) {
        setError('Missing position attributes in geometry');
        return;
      }

      const layerPositions = layerGeometry.attributes.position.array as Float32Array;
      const terrainPositions = terrainGeometry.attributes.position.array as Float32Array;

      console.log('Geometry attributes:', {
        terrainAttributes: Object.keys(terrainGeometry.attributes),
        layerAttributes: Object.keys(layerGeometry.attributes),
        terrainPositionsLength: terrainPositions.length,
        layerPositionsLength: layerPositions.length
      });

      // Get world matrices to transform vertices to world space
      layerMesh.updateMatrixWorld(true);
      terrainMesh.updateMatrixWorld(true);

      const data: VertexData[] = [];
      const maxVertices = Math.min(100, layerPositions.length / 3); // Limit to first 100 vertices for performance

      // Helper function to find terrain height at a given world position
      const getTerrainHeightAt = (worldX: number, worldY: number): number => {
        // Check if terrain has varying elevation data
        let minZ = Infinity;
        let maxZ = -Infinity;
        let terrainVerticesWithElevation = [];

        // Sample terrain to find elevation range and structure
        // Focus on vertices that are likely to be the top surface (higher Z values)
        for (let i = 0; i < terrainPositions.length; i += 3) {
          const x = terrainPositions[i];
          const y = terrainPositions[i + 1];
          const z = terrainPositions[i + 2];

          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);

          // Only collect vertices that are likely surface vertices (not bottom/sides)
          // For now, include all but we'll filter later
          terrainVerticesWithElevation.push({ x, y, z });
        }

        // Filter to get only surface vertices (top 25% of elevation range)
        const elevationThreshold = minZ + (maxZ - minZ) * 0.75;
        const surfaceVertices = terrainVerticesWithElevation.filter(v => v.z >= elevationThreshold);

        console.log('Surface vertex filtering:', {
          totalVertices: terrainVerticesWithElevation.length,
          elevationThreshold,
          surfaceVertices: surfaceVertices.length,
          surfaceVertexSamples: surfaceVertices.slice(0, 10)
        });

        console.log('Terrain elevation analysis:', {
          minZ, maxZ,
          elevationRange: maxZ - minZ,
          hasElevationData: (maxZ - minZ) > 0.001,
          sampleCount: terrainVerticesWithElevation.length,
          firstFewVertices: terrainVerticesWithElevation.slice(0, 10)
        });

        // If terrain has elevation variations, use proper interpolation
        if ((maxZ - minZ) > 0.001) {
          // Use surface vertices for terrain height calculation
          const verticesForInterpolation = surfaceVertices.length > 100 ? surfaceVertices : terrainVerticesWithElevation;

          // Find the closest surface terrain vertices
          const distances = verticesForInterpolation.map(v => ({
            ...v,
            distance: Math.sqrt((v.x - worldX) ** 2 + (v.y - worldY) ** 2)
          })).sort((a, b) => a.distance - b.distance);

          if (distances.length > 0) {
            // Use nearest neighbor for now (can improve to bilinear later)
            const nearestVertex = distances[0];
            const interpolatedHeight = nearestVertex.z;

            // Transform to world space
            const worldVertex = new THREE.Vector3(nearestVertex.x, nearestVertex.y, interpolatedHeight);
            worldVertex.applyMatrix4(terrainMesh.matrixWorld);

            console.log('Terrain height interpolation:', {
              worldX, worldY,
              nearestVertex: nearestVertex,
              interpolatedHeight,
              worldHeight: worldVertex.z,
              distance: nearestVertex.distance,
              usedSurfaceVertices: verticesForInterpolation === surfaceVertices
            });

            return worldVertex.z;
          }
        }

        // Fallback: use terrain mesh base position + any scale/transform
        const terrainBase = terrainMesh.position.z;
        console.log('Using terrain base height:', terrainBase);
        return terrainBase;
      };

      // Sample vertices (focus on bottom vertices)
      for (let vertexIndex = 0; vertexIndex < maxVertices; vertexIndex++) {
        const i = vertexIndex * 3;

        if (i + 2 >= layerPositions.length) break;

        // Create vertex in local space
        const localVertex = new THREE.Vector3(
          layerPositions[i],
          layerPositions[i + 1],
          layerPositions[i + 2]
        );

        // Transform to world space
        const worldVertex = localVertex.clone();
        worldVertex.applyMatrix4(layerMesh.matrixWorld);

        // Get terrain height at this world position
        const terrainHeight = getTerrainHeightAt(worldVertex.x, worldVertex.y);

        data.push({
          vertexId: vertexIndex,
          x: parseFloat(worldVertex.x.toFixed(3)),
          y: parseFloat(worldVertex.y.toFixed(3)),
          layerZ: parseFloat(worldVertex.z.toFixed(3)),
          terrainZ: parseFloat(terrainHeight.toFixed(3)),
          difference: parseFloat((worldVertex.z - terrainHeight).toFixed(3))
        });
      }

      setVertexData(data);
    } catch (err) {
      setError(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getStatusChip = (difference: number) => {
    const tolerance = 0.1;
    if (Math.abs(difference) <= tolerance) {
      return <Chip label="Aligned" color="success" size="small" />;
    } else if (difference < -tolerance) {
      return <Chip label="Submerged" color="error" size="small" />;
    } else {
      return <Chip label="Floating" color="warning" size="small" />;
    }
  };

  const getRowColor = (difference: number) => {
    const tolerance = 0.1;
    if (Math.abs(difference) <= tolerance) {
      return 'success.light';
    } else if (difference < -tolerance) {
      return 'error.light';
    } else {
      return 'warning.light';
    }
  };

  const summary = React.useMemo(() => {
    if (!vertexData.length) return null;

    const tolerance = 0.1;
    const aligned = vertexData.filter(v => Math.abs(v.difference) <= tolerance).length;
    const submerged = vertexData.filter(v => v.difference < -tolerance).length;
    const floating = vertexData.filter(v => v.difference > tolerance).length;

    return { aligned, submerged, floating, total: vertexData.length };
  }, [vertexData]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: { height: '80vh' }
      }}
    >
      <DialogTitle>
        Debug Vertex Heights: {layerName}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Analyzing mesh vertex positions relative to terrain
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {isAnalyzing && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Analyzing vertices...
          </Alert>
        )}

        {summary && (
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Summary ({summary.total} vertices analyzed)
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Chip
                label={`${summary.aligned} Aligned`}
                color="success"
                variant="outlined"
              />
              <Chip
                label={`${summary.submerged} Submerged`}
                color="error"
                variant="outlined"
              />
              <Chip
                label={`${summary.floating} Floating`}
                color="warning"
                variant="outlined"
              />
            </Box>
          </Paper>
        )}

        {vertexData.length > 0 && (
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Vertex #</TableCell>
                  <TableCell align="right">World X</TableCell>
                  <TableCell align="right">World Y</TableCell>
                  <TableCell align="right">Layer Z</TableCell>
                  <TableCell align="right">Terrain Z</TableCell>
                  <TableCell align="right">Difference</TableCell>
                  <TableCell align="center">Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {vertexData.map((row) => (
                  <TableRow
                    key={row.vertexId}
                    sx={{
                      backgroundColor: getRowColor(row.difference),
                      opacity: 0.8
                    }}
                  >
                    <TableCell>{row.vertexId}</TableCell>
                    <TableCell align="right">{row.x}</TableCell>
                    <TableCell align="right">{row.y}</TableCell>
                    <TableCell align="right">{row.layerZ}</TableCell>
                    <TableCell align="right">{row.terrainZ}</TableCell>
                    <TableCell align="right">{row.difference}</TableCell>
                    <TableCell align="center">
                      {getStatusChip(row.difference)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {!isAnalyzing && !error && vertexData.length === 0 && (
          <Alert severity="info">
            No vertex data available. Ensure both layer and terrain meshes are loaded.
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={analyzeVertices} disabled={isAnalyzing || !layerMesh || !terrainMesh}>
          Re-analyze
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default VertexDebugDialog;