/**
 * WASM Context Pool Manager
 * Manages multiple WASM contexts for parallel processing
 * Each context runs in its own Web Worker to avoid single-thread limitations
 */

import { getWasmModule } from "@threegis/core";
import { sharedResourceManager } from './SharedResourceManager';

// ================================================================================
// Types and Interfaces
// ================================================================================

export interface WasmContextConfig {
  maxContexts: number;
  timeoutMs: number;
  enableDebugLogging: boolean;
}

export interface WasmContext {
  id: string;
  workerId: string;
  isActive: boolean;
  currentTask: string | null;
  createdAt: number;
  lastUsedAt: number;
}

export interface ContextTask<TInput, TOutput> {
  id: string;
  functionName: string;
  input: TInput;
  priority: number;
  abortController: AbortController;
  resolve: (result: TOutput) => void;
  reject: (error: Error) => void;
  createdAt: number;
}

export interface ContextPoolStats {
  totalContexts: number;
  activeContexts: number;
  idleContexts: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageTaskTime: number;
}

// Import the WASM worker for proper module loading
import WasmLayerWorker from '../workers/wasmLayerWorker?worker';

// ================================================================================
// Context Pool Manager
// ================================================================================

export class WasmContextPool {
  private contexts = new Map<string, WasmContext>();
  private workers = new Map<string, Worker>();
  private taskQueue: ContextTask<any, any>[] = [];
  private config: WasmContextConfig;
  private stats = {
    completedTasks: 0,
    failedTasks: 0,
    totalTaskTime: 0
  };

  constructor(config: Partial<WasmContextConfig> = {}) {
    this.config = {
      maxContexts: config.maxContexts || 4,
      timeoutMs: config.timeoutMs || 30000,
      enableDebugLogging: config.enableDebugLogging || false
    };

    this.log('WasmContextPool initialized with config:', this.config);
  }

  // ================================================================================
  // Context Management
  // ================================================================================

  async createContext(): Promise<string> {
    if (this.contexts.size >= this.config.maxContexts) {
      throw new Error(`Maximum context limit reached: ${this.config.maxContexts}`);
    }

    const contextId = `wasm-ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const workerId = `worker-${contextId}`;

    try {
      // Create worker with proper WASM module loading
      const worker = new WasmLayerWorker();

      // Set up error handling
      worker.onerror = (error) => {
        
      };

      // Initialize WASM in the worker
      await this.initializeWorker(worker);

      const context: WasmContext = {
        id: contextId,
        workerId,
        isActive: false,
        currentTask: null,
        createdAt: Date.now(),
        lastUsedAt: Date.now()
      };

      this.contexts.set(contextId, context);
      this.workers.set(workerId, worker);

      this.log(`Created WASM context: ${contextId}`);

      return contextId;
    } catch (error) {
      this.log(`Failed to create WASM context: ${error}`);
      throw new Error(`Failed to create WASM context: ${error}`);
    }
  }

  private async initializeWorker(worker: Worker): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker initialization timeout'));
      }, this.config.timeoutMs);

      const messageHandler = (event: MessageEvent) => {
        if (event.data.type === 'initialized') {
          clearTimeout(timeout);
          worker.removeEventListener('message', messageHandler);

          if (event.data.data?.success) {
            resolve();
          } else {
            reject(new Error(event.data.error || 'Worker initialization failed'));
          }
        }
      };

      worker.addEventListener('message', messageHandler);

      // Send initialization request with unique ID
      const initId = `init-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      worker.postMessage({
        id: initId,
        type: 'init'
      });
    });
  }

  async destroyContext(contextId: string): Promise<void> {
    const context = this.contexts.get(contextId);
    if (!context) {
      this.log(`Context not found for destruction: ${contextId}`);
      return;
    }

    const worker = this.workers.get(context.workerId);
    if (worker) {
      worker.postMessage({ type: 'terminate' });
      worker.terminate();
      this.workers.delete(context.workerId);
    }

    this.contexts.delete(contextId);
    this.log(`Destroyed WASM context: ${contextId}`);
  }

  async destroyAllContexts(): Promise<void> {
    const destroyPromises = Array.from(this.contexts.keys()).map(
      contextId => this.destroyContext(contextId)
    );
    await Promise.all(destroyPromises);
    this.log('All WASM contexts destroyed');
  }

  // ================================================================================
  // Task Execution
  // ================================================================================

  /**
   * Process a layer using a dedicated WASM context
   */
  async processLayerInContext(
    layerConfig: any,
    bboxCoords: [number, number, number, number],
    processId: string,
    terrainData: any,
    terrainSettings: any,
    debugMode: boolean = false,
    options: {
      priority?: number;
      timeout?: number;
      contextId?: string;
      onProgress?: (progress: number, message: string) => void;
    } = {}
  ): Promise<any> {
    const taskId = `layer-${layerConfig.sourceLayer}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return new Promise<any>((resolve, reject) => {
      const timeout = options.timeout || this.config.timeoutMs;

      // Find or create context
      const contextId = options.contextId || this.findIdleContext();
      if (!contextId) {
        reject(new Error('No available WASM context'));
        return;
      }

      const context = this.contexts.get(contextId);
      const worker = this.workers.get(context!.workerId);

      if (!context || !worker) {
        reject(new Error(`Context or worker not found: ${contextId}`));
        return;
      }

      context.isActive = true;
      context.currentTask = taskId;
      context.lastUsedAt = Date.now();

      const startTime = Date.now();

      // Set up timeout
      const timeoutId = setTimeout(() => {
        worker.removeEventListener('message', messageHandler);
        context.isActive = false;
        context.currentTask = null;
        reject(new Error(`Layer processing timeout after ${timeout}ms`));
      }, timeout);

      // Handle worker messages
      const messageHandler = (event: MessageEvent) => {
        if (event.data.id === taskId) {
          const { type, data, progress, error } = event.data;

          if (type === 'progress') {
            if (options.onProgress && data?.message) {
              options.onProgress(progress || 0, data.message);
            }
          } else if (type === 'result') {
            clearTimeout(timeoutId);
            worker.removeEventListener('message', messageHandler);

            const executionTime = Date.now() - startTime;
            this.updateStats(executionTime, true);

            context.isActive = false;
            context.currentTask = null;

            this.log(`Layer processing completed in ${executionTime}ms: ${layerConfig.sourceLayer}`);
            resolve(data);

            // Process next queued task
            this.processNextTask();

          } else if (type === 'error') {
            clearTimeout(timeoutId);
            worker.removeEventListener('message', messageHandler);

            const executionTime = Date.now() - startTime;
            this.updateStats(executionTime, false);

            context.isActive = false;
            context.currentTask = null;

            this.log(`Layer processing failed after ${executionTime}ms: ${error}`);
            reject(new Error(error || 'Layer processing failed'));

            // Process next queued task
            this.processNextTask();
          }
        }
      };

      worker.addEventListener('message', messageHandler);

      // Send layer processing task to worker directly
      // Workers will handle their own vector tile fetching
      worker.postMessage({
        id: taskId,
        type: 'process-layer',
        data: {
          layerConfig,
          bboxCoords,
          processId,
          terrainData,
          terrainSettings,
          debugMode
        }
      });

      this.log(`Started layer processing in context ${contextId}: ${layerConfig.sourceLayer}`);
    });
  }

  async executeInContext<TInput, TOutput>(
    functionName: string,
    input: TInput,
    options: {
      priority?: number;
      timeout?: number;
      preferredContext?: string;
      abortSignal?: AbortSignal;
    } = {}
  ): Promise<TOutput> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const priority = options.priority || 0;
    const timeout = options.timeout || this.config.timeoutMs;

    return new Promise<TOutput>((resolve, reject) => {
      const abortController = new AbortController();

      // Handle external abort signal
      if (options.abortSignal) {
        options.abortSignal.addEventListener('abort', () => {
          abortController.abort();
          reject(new Error('Task aborted by external signal'));
        });
      }

      const task: ContextTask<TInput, TOutput> = {
        id: taskId,
        functionName,
        input,
        priority,
        abortController,
        resolve,
        reject,
        createdAt: Date.now()
      };

      // Try to find an idle context or queue the task
      const contextId = this.findIdleContext(options.preferredContext);
      if (contextId) {
        this.executeTask(task, contextId);
      } else {
        this.queueTask(task);
      }
    });
  }

  private findIdleContext(preferredContext?: string): string | null {
    // Check preferred context first
    if (preferredContext) {
      const context = this.contexts.get(preferredContext);
      if (context && !context.isActive) {
        return preferredContext;
      }
    }

    // Find any idle context
    for (const [contextId, context] of this.contexts) {
      if (!context.isActive) {
        return contextId;
      }
    }

    return null;
  }

  private queueTask<TInput, TOutput>(task: ContextTask<TInput, TOutput>): void {
    // Insert task in priority queue (higher priority first)
    let insertIndex = this.taskQueue.length;
    for (let i = 0; i < this.taskQueue.length; i++) {
      if (this.taskQueue[i].priority < task.priority) {
        insertIndex = i;
        break;
      }
    }

    this.taskQueue.splice(insertIndex, 0, task);
    this.log(`Queued task ${task.id} with priority ${task.priority} (queue size: ${this.taskQueue.length})`);
  }

  private async executeTask<TInput, TOutput>(
    task: ContextTask<TInput, TOutput>,
    contextId: string
  ): Promise<void> {
    const context = this.contexts.get(contextId);
    const worker = this.workers.get(context!.workerId);

    if (!context || !worker) {
      task.reject(new Error(`Context or worker not found: ${contextId}`));
      return;
    }

    context.isActive = true;
    context.currentTask = task.id;
    context.lastUsedAt = Date.now();

    this.log(`Executing task ${task.id} in context ${contextId}`);

    const startTime = Date.now();

    // Set up message handling
    const messageHandler = (event: MessageEvent) => {
      if (event.data.taskId === task.id) {
        worker.removeEventListener('message', messageHandler);

        const executionTime = Date.now() - startTime;
        this.updateStats(executionTime, event.data.type === 'result');

        context.isActive = false;
        context.currentTask = null;

        if (event.data.type === 'result') {
          task.resolve(event.data.result);
          this.log(`Task ${task.id} completed in ${executionTime}ms`);
        } else if (event.data.type === 'error') {
          task.reject(new Error(event.data.error || 'Task execution failed'));
          this.log(`Task ${task.id} failed after ${executionTime}ms: ${event.data.error}`);
        }

        // Process next task in queue
        this.processNextTask();
      }
    };

    // Handle task cancellation
    task.abortController.signal.addEventListener('abort', () => {
      worker.removeEventListener('message', messageHandler);
      context.isActive = false;
      context.currentTask = null;
      task.reject(new Error('Task was cancelled'));
      this.log(`Task ${task.id} cancelled`);
      this.processNextTask();
    });

    worker.addEventListener('message', messageHandler);

    // Send task to worker
    worker.postMessage({
      type: 'execute',
      taskId: task.id,
      functionName: task.functionName,
      input: task.input,
      timeout: this.config.timeoutMs
    });
  }

  private processNextTask(): void {
    if (this.taskQueue.length === 0) {
      return;
    }

    const contextId = this.findIdleContext();
    if (contextId) {
      const nextTask = this.taskQueue.shift()!;
      this.executeTask(nextTask, contextId);
    }
  }

  private updateStats(executionTime: number, success: boolean): void {
    if (success) {
      this.stats.completedTasks++;
    } else {
      this.stats.failedTasks++;
    }

    this.stats.totalTaskTime += executionTime;
  }

  // ================================================================================
  // Pool Management
  // ================================================================================

  async ensureMinimumContexts(minContexts: number): Promise<void> {
    const currentContexts = this.contexts.size;
    if (currentContexts >= minContexts) {
      return;
    }

    const contextsToCreate = Math.min(minContexts - currentContexts, this.config.maxContexts - currentContexts);
    const creationPromises: Promise<string>[] = [];

    for (let i = 0; i < contextsToCreate; i++) {
      creationPromises.push(this.createContext());
    }

    try {
      await Promise.all(creationPromises);
      this.log(`Created ${contextsToCreate} additional contexts (total: ${this.contexts.size})`);
    } catch (error) {
      this.log(`Failed to create minimum contexts: ${error}`);
    }
  }

  async cleanupIdleContexts(maxIdleTime: number = 300000): Promise<void> { // 5 minutes
    const now = Date.now();
    const contextsToDestroy: string[] = [];

    for (const [contextId, context] of this.contexts) {
      if (!context.isActive && (now - context.lastUsedAt) > maxIdleTime) {
        contextsToDestroy.push(contextId);
      }
    }

    if (contextsToDestroy.length > 0) {
      const destroyPromises = contextsToDestroy.map(contextId => this.destroyContext(contextId));
      await Promise.all(destroyPromises);
      this.log(`Cleaned up ${contextsToDestroy.length} idle contexts`);
    }
  }

  getStats(): ContextPoolStats {
    const activeContexts = Array.from(this.contexts.values()).filter(ctx => ctx.isActive).length;
    const idleContexts = this.contexts.size - activeContexts;
    const averageTaskTime = this.stats.completedTasks > 0
      ? this.stats.totalTaskTime / this.stats.completedTasks
      : 0;

    return {
      totalContexts: this.contexts.size,
      activeContexts,
      idleContexts,
      queuedTasks: this.taskQueue.length,
      completedTasks: this.stats.completedTasks,
      failedTasks: this.stats.failedTasks,
      averageTaskTime
    };
  }

  // ================================================================================
  // Utility Methods
  // ================================================================================

  private log(message: string, ...args: any[]): void {
    if (this.config.enableDebugLogging) {
      
    }
  }

  // Public method for external logging
  enableLogging(enable: boolean): void {
    this.config.enableDebugLogging = enable;
  }
}

// ================================================================================
// Singleton Instance
// ================================================================================

let globalContextPool: WasmContextPool | null = null;

export function getWasmContextPool(config?: Partial<WasmContextConfig>): WasmContextPool {
  if (!globalContextPool) {
    globalContextPool = new WasmContextPool(config);
  }
  return globalContextPool;
}

export function resetWasmContextPool(): void {
  if (globalContextPool) {
    globalContextPool.destroyAllContexts();
    globalContextPool = null;
  }
}