import React from 'react';
import { styled, keyframes } from '@mui/material/styles';
import { Box, Typography, Paper, useMediaQuery, useTheme } from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import { useAppStore } from '../stores/useAppStore';

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

// Define the props for the ProcessingIndicator component (now optional)
interface ProcessingIndicatorProps {
  // Optional title to display at the top of the indicator (defaults to "Processing 3D Model")
  title?: string;
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
  width: '280px',
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

const StatusText = styled(Typography)({
  fontSize: '0.875rem',
  opacity: 0.9,
  marginTop: '8px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  letterSpacing: '0.2px',
  width: '100%',
  textAlign: 'center',
  lineHeight: '1.4',
});

const ProcessingIndicator: React.FC<ProcessingIndicatorProps> = ({
  title = "Processing 3D Model"
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  // Get state from the app store
  const { isProcessing, processingStatus } = useAppStore();

  // Don't render if not processing
  if (!isProcessing) {
    return null;
  }

  return (
    <ProcessingContainer
      elevation={8}
      sx={{
        opacity: 1,
        pointerEvents: 'none'
      }}
    >
      <TechLines sx={{backgroundImage:"linear-gradient(90deg, #42a5f5, #64ffda, #42a5f5)"}} />
      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 1 }}>
        <IconContainer>
          <CodeIcon color="primary" fontSize={"small"} />
        </IconContainer>
        <Typography variant={isMobile ? "body2" : "subtitle2"} fontWeight="600">
          {title}
        </Typography>
      </Box>
      
      {processingStatus && (
        <StatusText variant="body2">
          {processingStatus}
        </StatusText>
      )}
    </ProcessingContainer>
  );
};

export default ProcessingIndicator;
