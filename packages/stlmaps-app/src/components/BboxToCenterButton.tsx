import React, { useRef } from 'react';
import { Button, Tooltip } from '@mui/material';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';

interface BboxToCenterButtonProps {
  mapId?: string;
  bboxSelectorRef: React.RefObject<{ updateBbox: () => void }>;
}

const BboxToCenterButton: React.FC<BboxToCenterButtonProps> = ({ bboxSelectorRef }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Style the button similarly to the camera buttons in ModelPreview
  const buttonStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '10px',
    left: '10px',
    padding: '8px 12px',
    backgroundColor: '#2196F3',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    zIndex: '100',
    fontSize: '12px',
    boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  };

  const handleClick = () => {
    if (bboxSelectorRef.current) {
      bboxSelectorRef.current.updateBbox();
    }
  };

  return (
    <Tooltip title="Reset BBOX to map center">
      <Button
        ref={buttonRef}
        style={buttonStyle}
        onClick={handleClick}
        variant="contained"
        
      >
<CenterFocusStrongIcon />
      </Button>
    </Tooltip>
  );
};

export default BboxToCenterButton;
