import { GeometryGenerationService, type GeometryGenerationConfig, type GeometryGenerationCallbacks } from '../../geometry/services/GeometryGenerationService';
import { tokenManager } from '../../../utils/CancellationToken';

export interface ProcessingOrchestratorConfig {
  geometry: GeometryGenerationConfig;
}

export interface ProcessingOrchestratorCallbacks {
  onStart: () => void;
  onProgressUpdate: (status: string, progress: number) => void;
  onComplete: (result: any) => void;
  onError: (error: Error) => void;
  onCancel: () => void;
}

export class ProcessingOrchestrator {
  private geometryService: GeometryGenerationService;
  private currentCancellationToken: string | null = null;

  constructor() {
    this.geometryService = new GeometryGenerationService();
  }

  async startProcessing(
    config: ProcessingOrchestratorConfig,
    callbacks: ProcessingOrchestratorCallbacks
  ): Promise<void> {
    const { onStart, onProgressUpdate, onComplete, onError, onCancel } = callbacks;

    try {
      // Cancel any existing processing
      await this.cancelCurrentProcessing();

      // Generate new cancellation token
      const cancellationId = `geometry-generation-${Date.now()}`;
      this.currentCancellationToken = cancellationId;
      tokenManager.createToken(cancellationId);

      onStart();
      onProgressUpdate('Starting geometry processing...', 0);

      // Check for cancellation
      if (tokenManager.isCancelled(cancellationId)) {
        onCancel();
        return;
      }

      const geometryCallbacks: GeometryGenerationCallbacks = {
        onProgressUpdate: (status: string, progress: number) => {
          if (!tokenManager.isCancelled(cancellationId)) {
            onProgressUpdate(status, progress);
          }
        },
        onComplete: (result) => {
          if (!tokenManager.isCancelled(cancellationId)) {
            onComplete(result);
            this.currentCancellationToken = null;
          }
        },
        onError: (error) => {
          if (!tokenManager.isCancelled(cancellationId)) {
            onError(error);
            this.currentCancellationToken = null;
          }
        },
      };

      await this.geometryService.generateGeometry(config.geometry, geometryCallbacks);

    } catch (error) {
      onError(error as Error);
      this.currentCancellationToken = null;
    }
  }

  async cancelCurrentProcessing(): Promise<void> {
    if (this.currentCancellationToken) {
      tokenManager.cancel(this.currentCancellationToken);
      this.currentCancellationToken = null;
    }
  }

  isProcessing(): boolean {
    return this.currentCancellationToken !== null;
  }

  dispose(): void {
    this.cancelCurrentProcessing();
    this.geometryService.dispose();
  }
}