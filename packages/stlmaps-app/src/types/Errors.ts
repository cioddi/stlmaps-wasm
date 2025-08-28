/**
 * Application-specific error types for better error handling
 */

export enum ErrorCode {
  // Geometry Generation Errors
  GEOMETRY_GENERATION_FAILED = 'GEOMETRY_GENERATION_FAILED',
  TERRAIN_PROCESSING_FAILED = 'TERRAIN_PROCESSING_FAILED',
  VECTOR_PROCESSING_FAILED = 'VECTOR_PROCESSING_FAILED',
  
  // WASM Errors
  WASM_NOT_INITIALIZED = 'WASM_NOT_INITIALIZED',
  WASM_FUNCTION_FAILED = 'WASM_FUNCTION_FAILED',
  
  // Configuration Errors
  INVALID_BBOX = 'INVALID_BBOX',
  INVALID_LAYER_CONFIG = 'INVALID_LAYER_CONFIG',
  MISSING_REQUIRED_PARAMETER = 'MISSING_REQUIRED_PARAMETER',
  
  // Network Errors
  TILE_FETCH_FAILED = 'TILE_FETCH_FAILED',
  ELEVATION_FETCH_FAILED = 'ELEVATION_FETCH_FAILED',
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  
  // Processing Errors
  PROCESSING_CANCELLED = 'PROCESSING_CANCELLED',
  PROCESSING_TIMEOUT = 'PROCESSING_TIMEOUT',
  MEMORY_LIMIT_EXCEEDED = 'MEMORY_LIMIT_EXCEEDED',
  
  // Validation Errors
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  TYPE_MISMATCH = 'TYPE_MISMATCH',
  
  // Unknown Errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface AppErrorDetails {
  code: ErrorCode;
  message: string;
  context?: Record<string, any>;
  cause?: Error;
  timestamp?: Date;
  stack?: string;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly context?: Record<string, any>;
  public readonly cause?: Error;
  public readonly timestamp: Date;

  constructor(details: AppErrorDetails) {
    super(details.message);
    
    this.name = 'AppError';
    this.code = details.code;
    this.context = details.context;
    this.cause = details.cause;
    this.timestamp = details.timestamp || new Date();
    
    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
      cause: this.cause?.message,
    };
  }
}

// Error factory functions for common error types
export const createGeometryError = (message: string, context?: Record<string, any>, cause?: Error): AppError => 
  new AppError({
    code: ErrorCode.GEOMETRY_GENERATION_FAILED,
    message,
    context,
    cause,
  });

export const createWasmError = (message: string, context?: Record<string, any>, cause?: Error): AppError =>
  new AppError({
    code: ErrorCode.WASM_NOT_INITIALIZED,
    message,
    context,
    cause,
  });

export const createValidationError = (message: string, context?: Record<string, any>): AppError =>
  new AppError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    context,
  });

export const createNetworkError = (message: string, context?: Record<string, any>, cause?: Error): AppError =>
  new AppError({
    code: ErrorCode.TILE_FETCH_FAILED,
    message,
    context,
    cause,
  });