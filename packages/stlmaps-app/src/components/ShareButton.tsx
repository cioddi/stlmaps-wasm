import React, { useState } from 'react';
import { IconButton, Tooltip, Snackbar, Alert } from '@mui/material';
import ShareIcon from '@mui/icons-material/Share';
import { useUrlState } from '../hooks/useUrlState';

interface ShareButtonProps {
    size?: 'small' | 'medium' | 'large';
    color?: 'inherit' | 'default' | 'primary' | 'secondary';
}

/**
 * Button that copies the current shareable URL to clipboard
 */
const ShareButton: React.FC<ShareButtonProps> = ({
    size = 'medium',
    color = 'inherit'
}) => {
    const { copyShareableUrl } = useUrlState();
    const [snackbarOpen, setSnackbarOpen] = useState(false);
    const [snackbarMessage, setSnackbarMessage] = useState('');
    const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error'>('success');

    const handleShare = async () => {
        const success = await copyShareableUrl();
        if (success) {
            setSnackbarMessage('Link copied to clipboard!');
            setSnackbarSeverity('success');
        } else {
            setSnackbarMessage('Failed to copy link');
            setSnackbarSeverity('error');
        }
        setSnackbarOpen(true);
    };

    const handleCloseSnackbar = () => {
        setSnackbarOpen(false);
    };

    return (
        <>
            <Tooltip title="Copy shareable link">
                <IconButton
                    onClick={handleShare}
                    size={size}
                    color={color}
                    aria-label="share"
                >
                    <ShareIcon />
                </IconButton>
            </Tooltip>
            <Snackbar
                open={snackbarOpen}
                autoHideDuration={3000}
                onClose={handleCloseSnackbar}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    onClose={handleCloseSnackbar}
                    severity={snackbarSeverity}
                    sx={{ width: '100%' }}
                >
                    {snackbarMessage}
                </Alert>
            </Snackbar>
        </>
    );
};

export default ShareButton;
