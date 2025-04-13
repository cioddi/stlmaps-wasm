/**
 * WorkerService - A service to manage web worker instances and communication
 * This provides a clean interface to offload heavy computations to web workers
 */

// Define type for tracking active worker requests
interface WorkerRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeoutId: number;
}

// Configuration for worker timeouts
const WORKER_TIMEOUT = 60000; // 60 seconds timeout for worker operations

export class WorkerService {
  private static workers: Map<string, Worker> = new Map();
  private static requests: Map<string, WorkerRequest> = new Map();
  private static requestCounter = 0;

  /**
   * Initializes a worker with a specified name if it doesn't already exist
   * 
   * @param workerName - Unique name for the worker
   * @param workerPath - Path to the worker script
   * @returns The worker instance
   */
  public static initWorker(workerName: string, workerPath: string): Worker {
    // Return existing worker if already initialized
    if (this.workers.has(workerName)) {
      return this.workers.get(workerName)!;
    }
    
    // Create a new worker
    const worker = new Worker(new URL(workerPath, import.meta.url), { 
      type: 'module' 
    });
    
    // Set up message handling
    worker.onmessage = this.handleWorkerMessage.bind(this);
    worker.onerror = this.handleWorkerError.bind(this);
    
    // Store worker in the map
    this.workers.set(workerName, worker);
    
    return worker;
  }

  /**
   * Runs a task on a worker and returns a promise with the result
   * 
   * @param workerName - Name of the worker to use
   * @param workerPath - Path to the worker script
   * @param data - Data to send to the worker
   * @returns Promise that resolves with the worker's result
   */
  public static runWorkerTask(
    workerName: string, 
    workerPath: string, 
    data: any
  ): Promise<any> {
    const worker = this.initWorker(workerName, workerPath);
    const requestId = `${workerName}-${++this.requestCounter}`;
    
    // Create a promise that will be resolved when the worker responds
    return new Promise((resolve, reject) => {
      // Set up timeout to prevent hanging requests
      const timeoutId = window.setTimeout(() => {
        if (this.requests.has(requestId)) {
          this.requests.delete(requestId);
          reject(new Error(`Worker task ${requestId} timed out after ${WORKER_TIMEOUT / 1000} seconds`));
        }
      }, WORKER_TIMEOUT);
      
      // Store the request callbacks for later resolution
      this.requests.set(requestId, { resolve, reject, timeoutId });
      
      // Send data to worker with the request ID
      worker.postMessage({
        id: requestId,
        data,
      });
    });
  }

  /**
   * Handle messages received from workers
   */
  private static handleWorkerMessage(event: MessageEvent) {
    const { id, result, error, status } = event.data;
    
    // Find the matching request
    if (this.requests.has(id)) {
      const request = this.requests.get(id)!;
      
      // Clear the timeout
      clearTimeout(request.timeoutId);
      this.requests.delete(id);
      
      // Resolve or reject the promise based on status
      if (status === 'error') {
        request.reject(new Error(error || 'Unknown worker error'));
      } else {
        request.resolve(result);
      }
    }
  }

  /**
   * Handle worker errors
   */
  private static handleWorkerError(event: ErrorEvent) {
    console.error('Worker error:', event);
    
    // In case of general worker error, reject all pending requests
    for (const [id, request] of this.requests.entries()) {
      clearTimeout(request.timeoutId);
      request.reject(new Error(`Worker error: ${event.message}`));
      this.requests.delete(id);
    }
  }

  /**
   * Terminates a specific worker
   * 
   * @param workerName - Name of the worker to terminate
   */
  public static terminateWorker(workerName: string): void {
    if (this.workers.has(workerName)) {
      const worker = this.workers.get(workerName)!;
      worker.terminate();
      this.workers.delete(workerName);
      
      // Reject any pending requests for this worker
      for (const [id, request] of this.requests.entries()) {
        if (id.startsWith(`${workerName}-`)) {
          clearTimeout(request.timeoutId);
          request.reject(new Error(`Worker ${workerName} was terminated`));
          this.requests.delete(id);
        }
      }
    }
  }

  /**
   * Terminates all active workers
   */
  public static terminateAllWorkers(): void {
    for (const workerName of this.workers.keys()) {
      this.terminateWorker(workerName);
    }
  }
}
