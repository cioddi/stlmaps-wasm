import React, { useEffect } from 'react';
import { styled, keyframes } from '@mui/material/styles';
import { Box, Typography, LinearProgress, Paper } from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import useLayerStore from '../stores/useLayerStore';

// Pulsating animation for the icon
const pulse = keyframes`
  0% {
    opacity: 0.6;
    transform: scale(0.95);
  }
  50% {
    opacity: 1;
    transform: scale(1.05);
  }
  100% {
    opacity: 0.6;
    transform: scale(0.95);
  }
`;

// Animation for the tech lines
const flowAnimation = keyframes`
  0% {
    background-position: 0% 50%;
  }
  100% {
    background-position: 100% 50%;
  }
`;

// Styled components
const ProcessingContainer = styled(Paper)(({ theme }) => ({
  position: 'fixed',
  bottom: '2rem',
  right: '2rem',
  padding: '16px 24px',
  borderRadius: '12px',
  backgroundColor: 'rgba(34, 43, 54, 0.9)',
  backdropFilter: 'blur(8px)',
  color: '#fff',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  width: '300px',
  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
  overflow: 'hidden',
  transition: 'transform 0.3s ease-out, opacity 0.3s ease-out',
}));

const TechLines = styled(Box)({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: '4px',
  backgroundSize: '300% 100%',
  animation: `${flowAnimation} 3s linear infinite`,
});

const IconContainer = styled(Box)({
  animation: `${pulse} 2s ease-in-out infinite`,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  backgroundColor: 'rgba(66, 165, 245, 0.15)',
  borderRadius: '50%',
  padding: '12px',
  marginBottom: '12px',
});

const StyledLinearProgress = styled(LinearProgress)(({ theme }) => ({
  width: '100%',
  height: '6px',
  marginTop: '12px',
  borderRadius: '3px',
  backgroundColor: 'rgba(255, 255, 255, 0.1)',
  '& .MuiLinearProgress-bar': {
    background: 'linear-gradient(90deg, #42a5f5, #64ffda)',
  },
}));

const StatusText = styled(Typography)({
  fontSize: '0.875rem',
  opacity: 0.85,
  marginTop: '8px',
  fontFamily: 'monospace',
  letterSpacing: '0.3px',
});

const ProcessingIndicator = () => {
  const { isProcessing, processingStatus, processingProgress } = useLayerStore();
  
  // Escape hatch for component when not processing

  return (
    <ProcessingContainer
      elevation={8}
      sx={{
        transform: isProcessing ? 'translateY(0)' : 'translateY(150px)',
        opacity: isProcessing ? 1 : 0,
      }}
    >
      <TechLines />
      <IconContainer>
        <CodeIcon color="primary" fontSize="large" />
      </IconContainer>
      <Typography variant="subtitle1" fontWeight="600" textAlign="center">
        Processing 3D Model
      </Typography>
      <StyledLinearProgress 
        variant={processingProgress !== null ? "determinate" : "indeterminate"} 
        value={processingProgress !== null ? processingProgress : undefined}
      />
      <StatusText variant="caption">
        {processingStatus || "Initializing..."}
      </StatusText>
    </ProcessingContainer>
  );
};

export default ProcessingIndicator;
