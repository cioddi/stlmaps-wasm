import React, { useEffect, useState, useCallback } from 'react';
import { styled, keyframes } from '@mui/material/styles';
import { Box, Typography, LinearProgress, Paper, useMediaQuery, useTheme } from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
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

// Define the processing steps that will be tracked
interface ProcessingStep {
  id: string;
  label: string;
  status: 'not-started' | 'in-progress' | 'completed';
  order: number;
}

// Define the props for the ProcessingIndicator component
interface ProcessingIndicatorProps {
  // Show/hide the indicator
  isVisible: boolean;
  // Title to display at the top of the indicator
  title: string;
  // Current progress (0-100)
  progress: number | null;
  // Current status message to display
  statusMessage: string | null;
  // Array of steps to display
  steps: ProcessingStep[];
  // ID of the current active step
  activeStepId: string | null;
}

// Styled components
const ProcessingContainer = styled(Paper)(({ theme }) => ({
  position: 'fixed',
  bottom: '1rem',
  right: '1rem',
  transform: 'none',
  padding: '16px 20px',
  borderRadius: '12px',
  backgroundColor: 'rgba(34, 43, 54, 0.95)',
  backdropFilter: 'blur(8px)',
  color: '#fff',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  width: '320px',
  maxWidth: 'calc(100vw - 2rem)',
  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
  overflow: 'hidden',
  transition: 'all 0.3s ease-out',
  [theme.breakpoints.down('sm')]: {
    bottom: '0.75rem',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'calc(100vw - 1.5rem)',
    padding: '12px 16px',
  }
}));

const TechLines = styled(Box)({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: '4px',
  backgroundSize: '300% 100%',
  animation: `${flowAnimation} 3s linear infinite`,
  backgroundImage: 'linear-gradient(90deg, #42a5f5, #64ffda, #42a5f5)',
});

const IconContainer = styled(Box)(({ theme }) => ({
  animation: `${pulse} 2s ease-in-out infinite`,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  backgroundColor: 'rgba(66, 165, 245, 0.15)',
  borderRadius: '50%',
  padding: '8px',
  marginBottom: '8px',
  marginRight: '6px',
  [theme.breakpoints.down('sm')]: {
    padding: '6px',
    marginBottom: '6px',
  }
}));

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
  fontSize: '0.75rem',
  opacity: 0.85,
  marginTop: '4px',
  fontFamily: 'monospace',
  letterSpacing: '0.3px',
  width: '100%',
  textAlign: 'left',
});

const ProcessingStepContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  marginTop: '2px',
  padding: '2px 0',
}));

const StepIcon = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'status'
})<{ status: ProcessingStep['status'] }>(({ status, theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: '8px',
  color: status === 'completed' 
    ? theme.palette.success.main 
    : status === 'in-progress' 
      ? theme.palette.info.main 
      : 'rgba(100, 100, 100, 0.7)',
}));

const ProcessingIndicator: React.FC<ProcessingIndicatorProps> = ({
  isVisible = false,
  title = "Processing",
  progress = null,
  statusMessage = null,
  steps = [],
  activeStepId = null
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <ProcessingContainer
      elevation={8}
      sx={{
        opacity: isVisible ? 1 : 0,
        pointerEvents: 'none'
      }}
    >
      <TechLines backgroundImage="linear-gradient(90deg, #42a5f5, #64ffda, #42a5f5)" />
      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 1 }}>
        <IconContainer>
          <CodeIcon color="primary" fontSize={"small"} />
        </IconContainer>
        <Typography variant={isMobile ? "body1" : "subtitle1"} fontWeight="600">
          {title}
        </Typography>
      </Box>
      
      <StyledLinearProgress 
        variant={progress !== null ? "determinate" : "indeterminate"} 
        value={progress !== null ? progress : undefined}
      />
      
      <Box sx={{ width: '100%', mt: 2, mb: 1 }}>
        {steps.map((step) => (
          <ProcessingStepContainer key={step.id}>
            <StepIcon status={step.status}>
              {step.status === 'completed' ? (
                <CheckCircleOutlineIcon color="inherit" fontSize="small" />
              ) : step.status === 'in-progress' ? (
                <Box 
                  sx={{ 
                    width: 18, 
                    height: 18, 
                    borderRadius: '50%', 
                    border: '2px solid', 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }} 
                >
                  <Box 
                    sx={{ 
                      width: 8, 
                      height: 8, 
                      borderRadius: '50%', 
                      bgcolor: 'currentColor' 
                    }} 
                  />
                </Box>
              ) : (
                <Box 
                  sx={{ 
                    width: 18, 
                    height: 18, 
                    borderRadius: '50%', 
                    border: '2px solid', 
                    opacity: 0.5 
                  }} 
                />
              )}
            </StepIcon>
            <Box sx={{ flexGrow: 1 }}>
              <Typography 
                variant="caption" 
                sx={{ 
                  fontWeight: step.id === activeStepId ? 600 : 400,
                  opacity: step.status !== 'not-started' ? 1 : 0.5
                }}
              >
                {step.label}
              </Typography>
              {step.id === activeStepId && statusMessage && (
                <StatusText variant="caption">{" "}
                  {statusMessage}
                </StatusText>
              )}
            </Box>
          </ProcessingStepContainer>
        ))}
      </Box>
    </ProcessingContainer>
  );
};

export default ProcessingIndicator;
