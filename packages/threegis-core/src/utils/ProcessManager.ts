/**
 * Process management system for 3D model generation
 * Replaces bbox-based caching with process-based resource management
 */

export interface ProcessConfig {
  bbox: [number, number, number, number];
  terrainSettings: {
    enabled: boolean;
    verticalExaggeration: number;
    baseHeight: number;
  };
  layers: Array<{
    sourceLayer: string;
    label?: string;
    enabled: boolean;
    color: string;
    extrusionDepth?: number;
    minExtrusionDepth?: number;
    heightScaleFactor: number;
    useAdaptiveScaleFactor: boolean;
    zOffset: number;
    alignVerticesToTerrain: boolean;
    filter?: any;
  }>;
  renderingSettings?: {
    mode: 'quality' | 'performance';
    shadows: boolean;
    antialias: boolean;
  };
}

export interface ProcessStatus {
  id: string;
  status: 'initializing' | 'fetching' | 'processing' | 'completed' | 'cancelled' | 'error';
  progress: number;
  message: string;
  startTime: number;
  endTime?: number;
  error?: Error;
}

export interface ProcessResult {
  processId: string;
  terrainGeometry?: any;
  layerGeometries: Map<string, any>;
  metadata: {
    totalFeatures: number;
    processingTime: number;
    layers: string[];
  };
}

class ProcessManager {
  private processes = new Map<string, ProcessStatus>();
  private processResults = new Map<string, ProcessResult>();
  private processConfigs = new Map<string, ProcessConfig>();
  private currentProcess: string | null = null;
  private abortControllers = new Map<string, AbortController>();
  private listeners = new Set<(status: ProcessStatus) => void>();

  /**
   * Generate a unique process ID
   */
  private generateProcessId(): string {
    return `process_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Start a new 3D model generation process
   */
  async startProcess(config: ProcessConfig): Promise<string> {
    const processId = this.generateProcessId();

    // Cancel current process if running
    if (this.currentProcess) {
      await this.cancelProcess(this.currentProcess);
    }

    // Initialize new process
    const abortController = new AbortController();
    this.abortControllers.set(processId, abortController);
    this.processConfigs.set(processId, config);
    this.currentProcess = processId;

    const status: ProcessStatus = {
      id: processId,
      status: 'initializing',
      progress: 0,
      message: 'Initializing process...',
      startTime: Date.now()
    };

    this.processes.set(processId, status);
    this.notifyListeners(status);

    return processId;
  }

  /**
   * Update process status
   */
  updateProcessStatus(
    processId: string,
    updates: Partial<Omit<ProcessStatus, 'id' | 'startTime'>>
  ): void {
    const currentStatus = this.processes.get(processId);
    if (!currentStatus) return;

    const updatedStatus: ProcessStatus = {
      ...currentStatus,
      ...updates,
      endTime: updates.status === 'completed' || updates.status === 'cancelled' || updates.status === 'error'
        ? Date.now()
        : currentStatus.endTime
    };

    this.processes.set(processId, updatedStatus);
    this.notifyListeners(updatedStatus);

    // Clean up completed processes
    if (updatedStatus.status === 'completed' || updatedStatus.status === 'cancelled' || updatedStatus.status === 'error') {
      if (this.currentProcess === processId) {
        this.currentProcess = null;
      }
      this.abortControllers.delete(processId);
    }
  }

  /**
   * Cancel a process and clean up resources
   */
  async cancelProcess(processId: string): Promise<void> {
    const abortController = this.abortControllers.get(processId);
    if (abortController) {
      abortController.abort();
    }

    this.updateProcessStatus(processId, {
      status: 'cancelled',
      message: 'Process cancelled by user'
    });

    // Clear cached resources for this process
    await this.clearProcessResources(processId);
  }

  /**
   * Clear all cached resources for a process
   */
  private async clearProcessResources(processId: string): Promise<void> {
    // Clear WASM module cache
    try {
      const { getWasmModule } = await import('../wasm/wasmBridge');
      const wasmModule = getWasmModule();

      if (wasmModule && typeof wasmModule.clear_process_cache_js === 'function') {
        wasmModule.clear_process_cache_js(processId);
      }
    } catch (error) {
      
    }

    // Remove process data
    this.processResults.delete(processId);
    this.processConfigs.delete(processId);
  }

  /**
   * Get current process status
   */
  getCurrentProcess(): ProcessStatus | null {
    if (!this.currentProcess) return null;
    return this.processes.get(this.currentProcess) || null;
  }

  /**
   * Get process by ID
   */
  getProcess(processId: string): ProcessStatus | null {
    return this.processes.get(processId) || null;
  }

  /**
   * Get process configuration
   */
  getProcessConfig(processId: string): ProcessConfig | null {
    return this.processConfigs.get(processId) || null;
  }

  /**
   * Store process result
   */
  setProcessResult(processId: string, result: ProcessResult): void {
    this.processResults.set(processId, result);
  }

  /**
   * Get process result
   */
  getProcessResult(processId: string): ProcessResult | null {
    return this.processResults.get(processId) || null;
  }

  /**
   * Get abort signal for a process
   */
  getAbortSignal(processId: string): AbortSignal | null {
    return this.abortControllers.get(processId)?.signal || null;
  }

  /**
   * Check if a process is cancelled
   */
  isProcessCancelled(processId: string): boolean {
    const abortController = this.abortControllers.get(processId);
    return abortController?.signal.aborted || false;
  }

  /**
   * Add status change listener
   */
  addStatusListener(listener: (status: ProcessStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of status change
   */
  private notifyListeners(status: ProcessStatus): void {
    this.listeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        
      }
    });
  }

  /**
   * Clean up old processes (keep only last 5)
   */
  cleanup(): void {
    const allProcesses = Array.from(this.processes.entries())
      .sort(([, a], [, b]) => b.startTime - a.startTime);

    // Keep only the 5 most recent processes
    const toDelete = allProcesses.slice(5);
    toDelete.forEach(([processId]) => {
      this.processes.delete(processId);
      this.processResults.delete(processId);
      this.processConfigs.delete(processId);
    });
  }
}

// Export singleton instance
export const processManager = new ProcessManager();