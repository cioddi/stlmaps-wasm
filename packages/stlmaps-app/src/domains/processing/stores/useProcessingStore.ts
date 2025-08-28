import { create } from 'zustand';
import type { ProcessingStore } from '../types/ProcessingTypes';

export const useProcessingStore = create<ProcessingStore>((set, get) => ({
  // State
  isProcessing: false,
  processingStatus: null,
  processingProgress: null,
  _forceUpdate: undefined,

  // Actions
  setProcessing: (isProcessing) =>
    set({ isProcessing }),

  updateProgress: (status, progress) => {
    // Force React updates using timestamp
    set(() => ({
      isProcessing: true,
      processingStatus: status,
      processingProgress: progress,
      _forceUpdate: Date.now(),
    }));
    
    // Additional forced update to ensure React sees the change
    setTimeout(() => {
      set((state) => ({
        ...state,
        processingStatus: status,
        processingProgress: progress,
        _forceUpdate: Date.now(),
      }));
    }, 0);
  },

  resetProcessing: () =>
    set({
      isProcessing: false,
      processingStatus: null,
      processingProgress: null,
      _forceUpdate: Date.now(),
    }),
}));