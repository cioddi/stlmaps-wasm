/**
 * A simple cancellation token system that allows for cancelling asynchronous operations
 */
export class CancellationToken {
  private _isCancelled = false;
  private _callbacks: (() => void)[] = [];

  /**
   * Check if this token has been cancelled
   */
  get isCancelled(): boolean {
    return this._isCancelled;
  }

  /**
   * Cancel this token, notifying all callbacks
   */
  cancel(): void {
    if (this._isCancelled) return;
    
    this._isCancelled = true;
    
    // Execute all registered callbacks
    this._callbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error in cancellation callback:', error);
      }
    });
    
    // Clear callbacks to prevent memory leaks
    this._callbacks = [];
  }

  /**
   * Register a callback to be executed when this token is cancelled
   */
  onCancel(callback: () => void): void {
    if (this._isCancelled) {
      // If already cancelled, execute callback immediately
      callback();
    } else {
      this._callbacks.push(callback);
    }
  }

  /**
   * Throws an error if the token has been cancelled
   * Use this inside async functions to exit early when cancelled
   */
  throwIfCancelled(): void {
    if (this._isCancelled) {
      throw new Error('Operation was cancelled');
    }
  }
}

/**
 * A manager for CancellationTokens that ensures only one token is active at a time
 */
export class CancellationTokenManager {
  private static _instance: CancellationTokenManager;
  private _currentToken: CancellationToken | null = null;
  private _currentOperationName: string | null = null;
  
  /**
   * Get the singleton instance of the token manager
   */
  public static getInstance(): CancellationTokenManager {
    if (!CancellationTokenManager._instance) {
      CancellationTokenManager._instance = new CancellationTokenManager();
    }
    return CancellationTokenManager._instance;
  }
  
  /**
   * Creates a new cancellation token for an operation, cancelling any existing token
   * 
   * @param operationName - A name for the operation (for logging)
   * @returns A new cancellation token
   */
  public getNewToken(operationName: string): CancellationToken {
    // Cancel any existing operation
    this.cancelCurrentOperation();
    
    // Create and store a new token
    this._currentToken = new CancellationToken();
    this._currentOperationName = operationName;
    
    console.log(`Starting new operation: ${operationName}`);
    return this._currentToken;
  }
  
  /**
   * Cancels the current operation if there is one
   */
  public cancelCurrentOperation(): void {
    if (this._currentToken && !this._currentToken.isCancelled) {
      console.log(`Cancelling operation: ${this._currentOperationName}`);
      this._currentToken.cancel();
    }
    
    this._currentToken = null;
    this._currentOperationName = null;
  }
  
  /**
   * Gets the current token if one exists
   */
  public getCurrentToken(): CancellationToken | null {
    return this._currentToken;
  }
}

// Export a singleton instance for easy access
export const tokenManager = CancellationTokenManager.getInstance();
