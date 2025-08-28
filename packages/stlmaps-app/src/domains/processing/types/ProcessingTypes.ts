export interface ProcessingState {
  isProcessing: boolean;
  processingStatus: string | null;
  processingProgress: number | null;
  _forceUpdate?: number; // Internal field to force React updates
}

export interface ProcessingActions {
  setProcessing: (isProcessing: boolean) => void;
  updateProgress: (status: string, progress: number) => void;
  resetProcessing: () => void;
}

export interface ProcessingStore extends ProcessingState, ProcessingActions {}