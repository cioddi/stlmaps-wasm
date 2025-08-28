import React, { Component, ReactNode, ErrorInfo } from 'react';
import { Box, Typography, Button, Paper, Alert, AlertTitle, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import { ExpandMore as ExpandMoreIcon, Refresh as RefreshIcon, BugReport as BugReportIcon } from '@mui/icons-material';
import { AppError, ErrorCode } from '../types/Errors';
import { config } from '../config';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetOnPropsChange?: boolean;
  resetKeys?: Array<string | number | boolean | null | undefined>;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  private resetTimeoutId: number | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    const errorId = `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    return {
      hasError: true,
      error,
      errorId,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });

    // Report error to monitoring service in production
    if (config.features.enableErrorReporting) {
      this.reportError(error, errorInfo);
    }

    // Call custom error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Log error details in development
    if (config.isDevelopment) {
      console.group('🚨 Error Boundary Caught Error');
      console.error('Error:', error);
      console.error('Error Info:', errorInfo);
      console.error('Component Stack:', errorInfo.componentStack);
      console.groupEnd();
    }
  }

  componentDidUpdate(prevProps: Props) {
    const { resetOnPropsChange, resetKeys } = this.props;
    const { hasError } = this.state;

    // Reset error state if resetKeys changed
    if (hasError && resetOnPropsChange && resetKeys) {
      const prevResetKeys = prevProps.resetKeys || [];
      
      if (resetKeys.length !== prevResetKeys.length || 
          resetKeys.some((key, index) => key !== prevResetKeys[index])) {
        this.resetError();
      }
    }
  }

  private reportError = (error: Error, errorInfo: ErrorInfo) => {
    // This would integrate with your error reporting service
    // (Sentry, LogRocket, etc.)
    const errorReport = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      userId: 'anonymous', // Replace with actual user ID if available
      errorId: this.state.errorId,
    };

    // In production, send to error reporting service
    if (config.isProduction) {
      // Example: Sentry.captureException(error, { extra: errorReport });
      console.log('Error reported:', errorReport);
    }
  };

  private resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
    });
  };

  private handleRetry = () => {
    this.resetError();
  };

  private handleReload = () => {
    window.location.reload();
  };

  private getErrorMessage = (error: Error): string => {
    if (error instanceof AppError) {
      switch (error.code) {
        case ErrorCode.WASM_NOT_INITIALIZED:
          return 'The WebAssembly module failed to initialize. Please refresh the page and try again.';
        case ErrorCode.GEOMETRY_GENERATION_FAILED:
          return 'Failed to generate 3D geometry. Please check your layer configuration and try again.';
        case ErrorCode.NETWORK_TIMEOUT:
          return 'Network request timed out. Please check your internet connection and try again.';
        case ErrorCode.VALIDATION_FAILED:
          return 'Invalid input detected. Please check your settings and try again.';
        default:
          return error.message || 'An unexpected error occurred.';
      }
    }
    
    return error.message || 'An unexpected error occurred.';
  };

  private getSeverity = (error: Error): 'error' | 'warning' => {
    if (error instanceof AppError) {
      switch (error.code) {
        case ErrorCode.NETWORK_TIMEOUT:
        case ErrorCode.VALIDATION_FAILED:
          return 'warning';
        default:
          return 'error';
      }
    }
    return 'error';
  };

  private getRecoveryActions = (error: Error): Array<{ label: string; action: () => void; primary?: boolean }> => {
    const actions = [
      { label: 'Try Again', action: this.handleRetry, primary: true },
    ];

    if (error instanceof AppError) {
      switch (error.code) {
        case ErrorCode.WASM_NOT_INITIALIZED:
        case ErrorCode.NETWORK_TIMEOUT:
          actions.push({ label: 'Reload Page', action: this.handleReload });
          break;
      }
    } else {
      actions.push({ label: 'Reload Page', action: this.handleReload });
    }

    return actions;
  };

  render() {
    const { hasError, error, errorInfo, errorId } = this.state;
    const { children, fallback } = this.props;

    if (hasError && error) {
      if (fallback) {
        return fallback;
      }

      const errorMessage = this.getErrorMessage(error);
      const severity = this.getSeverity(error);
      const recoveryActions = this.getRecoveryActions(error);

      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '50vh',
            padding: 3,
          }}
        >
          <Paper
            elevation={3}
            sx={{
              padding: 4,
              maxWidth: 600,
              width: '100%',
              textAlign: 'center',
            }}
          >
            <BugReportIcon
              sx={{
                fontSize: 64,
                color: severity === 'error' ? 'error.main' : 'warning.main',
                marginBottom: 2,
              }}
            />

            <Typography variant="h5" gutterBottom>
              Oops! Something went wrong
            </Typography>

            <Alert severity={severity} sx={{ textAlign: 'left', marginBottom: 3 }}>
              <AlertTitle>
                {severity === 'error' ? 'Error' : 'Warning'}
              </AlertTitle>
              {errorMessage}
            </Alert>

            {/* Recovery Actions */}
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', marginBottom: 3 }}>
              {recoveryActions.map((action, index) => (
                <Button
                  key={index}
                  variant={action.primary ? 'contained' : 'outlined'}
                  color={action.primary ? 'primary' : 'inherit'}
                  startIcon={action.label === 'Try Again' ? <RefreshIcon /> : undefined}
                  onClick={action.action}
                >
                  {action.label}
                </Button>
              ))}
            </Box>

            {/* Technical Details (Development/Debug) */}
            {(config.isDevelopment || config.processing.enableDebugMode) && (
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2">
                    Technical Details (Debug Info)
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box sx={{ textAlign: 'left' }}>
                    <Typography variant="caption" component="div" gutterBottom>
                      <strong>Error ID:</strong> {errorId}
                    </Typography>
                    
                    <Typography variant="caption" component="div" gutterBottom>
                      <strong>Error Type:</strong> {error.constructor.name}
                    </Typography>

                    {error instanceof AppError && (
                      <Typography variant="caption" component="div" gutterBottom>
                        <strong>Error Code:</strong> {error.code}
                      </Typography>
                    )}

                    <Typography variant="caption" component="div" gutterBottom>
                      <strong>Message:</strong> {error.message}
                    </Typography>

                    {error.stack && (
                      <Box sx={{ marginTop: 2 }}>
                        <Typography variant="caption" component="div" gutterBottom>
                          <strong>Stack Trace:</strong>
                        </Typography>
                        <Box
                          component="pre"
                          sx={{
                            fontSize: '0.7rem',
                            backgroundColor: 'grey.100',
                            padding: 1,
                            borderRadius: 1,
                            overflow: 'auto',
                            maxHeight: 200,
                          }}
                        >
                          {error.stack}
                        </Box>
                      </Box>
                    )}

                    {errorInfo?.componentStack && (
                      <Box sx={{ marginTop: 2 }}>
                        <Typography variant="caption" component="div" gutterBottom>
                          <strong>Component Stack:</strong>
                        </Typography>
                        <Box
                          component="pre"
                          sx={{
                            fontSize: '0.7rem',
                            backgroundColor: 'grey.100',
                            padding: 1,
                            borderRadius: 1,
                            overflow: 'auto',
                            maxHeight: 200,
                          }}
                        >
                          {errorInfo.componentStack}
                        </Box>
                      </Box>
                    )}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}
          </Paper>
        </Box>
      );
    }

    return children;
  }
}

// Higher-order component for automatic error boundary wrapping
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
): React.ComponentType<P> {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  
  return WrappedComponent;
}

// Specialized error boundaries for different sections
export const GeometryErrorBoundary: React.FC<{ children: ReactNode }> = ({ children }) => (
  <ErrorBoundary
    onError={(error) => {
      console.error('Geometry processing error:', error);
    }}
    fallback={
      <Alert severity="error">
        Failed to process geometry. Please check your layer configuration and try again.
      </Alert>
    }
  >
    {children}
  </ErrorBoundary>
);

export const UIErrorBoundary: React.FC<{ children: ReactNode }> = ({ children }) => (
  <ErrorBoundary
    onError={(error) => {
      console.error('UI component error:', error);
    }}
    fallback={
      <Alert severity="warning">
        A component failed to render. The rest of the application should continue to work.
      </Alert>
    }
  >
    {children}
  </ErrorBoundary>
);

export default ErrorBoundary;