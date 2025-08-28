/**
 * Performance monitoring system for the new domain architecture
 * Tracks render performance, memory usage, and store operations
 */

import { config } from '../config';

export interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface MemoryMetric {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  timestamp: number;
}

export interface StoreMetric {
  storeName: string;
  action: string;
  duration: number;
  stateSize: number;
  timestamp: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private memoryMetrics: MemoryMetric[] = [];
  private storeMetrics: StoreMetric[] = [];
  private isEnabled: boolean;
  private maxMetrics = 1000; // Keep last 1000 metrics

  constructor() {
    this.isEnabled = config.features.enablePerformanceMonitoring;
    
    if (this.isEnabled) {
      this.startMemoryMonitoring();
    }
  }

  /**
   * Measure the performance of a function
   */
  measure<T>(name: string, fn: () => T, metadata?: Record<string, any>): T {
    if (!this.isEnabled) {
      return fn();
    }

    const startTime = performance.now();
    const result = fn();
    const endTime = performance.now();
    
    this.addMetric({
      name,
      duration: endTime - startTime,
      timestamp: Date.now(),
      metadata,
    });
    
    return result;
  }

  /**
   * Measure async function performance
   */
  async measureAsync<T>(
    name: string, 
    fn: () => Promise<T>, 
    metadata?: Record<string, any>
  ): Promise<T> {
    if (!this.isEnabled) {
      return fn();
    }

    const startTime = performance.now();
    const result = await fn();
    const endTime = performance.now();
    
    this.addMetric({
      name,
      duration: endTime - startTime,
      timestamp: Date.now(),
      metadata,
    });
    
    return result;
  }

  /**
   * Start a performance measurement
   */
  startMeasurement(name: string): () => void {
    if (!this.isEnabled) {
      return () => {};
    }

    const startTime = performance.now();
    
    return (metadata?: Record<string, any>) => {
      const endTime = performance.now();
      this.addMetric({
        name,
        duration: endTime - startTime,
        timestamp: Date.now(),
        metadata,
      });
    };
  }

  /**
   * Record a store operation
   */
  recordStoreOperation(
    storeName: string,
    action: string,
    stateSize: number,
    duration: number
  ): void {
    if (!this.isEnabled) return;

    this.storeMetrics.push({
      storeName,
      action,
      duration,
      stateSize,
      timestamp: Date.now(),
    });

    // Keep only recent metrics
    if (this.storeMetrics.length > this.maxMetrics) {
      this.storeMetrics = this.storeMetrics.slice(-this.maxMetrics / 2);
    }
  }

  /**
   * Get performance summary
   */
  getSummary(): {
    averageRenderTime: number;
    slowestOperations: PerformanceMetric[];
    memoryTrend: 'increasing' | 'decreasing' | 'stable';
    totalOperations: number;
    storeOperationStats: Record<string, { count: number; avgDuration: number }>;
  } {
    if (!this.isEnabled || this.metrics.length === 0) {
      return {
        averageRenderTime: 0,
        slowestOperations: [],
        memoryTrend: 'stable',
        totalOperations: 0,
        storeOperationStats: {},
      };
    }

    // Calculate average render time
    const renderMetrics = this.metrics.filter(m => m.name.includes('render'));
    const averageRenderTime = renderMetrics.length > 0
      ? renderMetrics.reduce((sum, m) => sum + m.duration, 0) / renderMetrics.length
      : 0;

    // Find slowest operations
    const slowestOperations = [...this.metrics]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);

    // Analyze memory trend
    const recentMemory = this.memoryMetrics.slice(-10);
    let memoryTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    
    if (recentMemory.length >= 3) {
      const first = recentMemory[0].usedJSHeapSize;
      const last = recentMemory[recentMemory.length - 1].usedJSHeapSize;
      const threshold = first * 0.1; // 10% threshold
      
      if (last > first + threshold) {
        memoryTrend = 'increasing';
      } else if (last < first - threshold) {
        memoryTrend = 'decreasing';
      }
    }

    // Store operation statistics
    const storeOperationStats: Record<string, { count: number; avgDuration: number }> = {};
    
    this.storeMetrics.forEach(metric => {
      const key = `${metric.storeName}.${metric.action}`;
      if (!storeOperationStats[key]) {
        storeOperationStats[key] = { count: 0, avgDuration: 0 };
      }
      
      const stats = storeOperationStats[key];
      stats.avgDuration = (stats.avgDuration * stats.count + metric.duration) / (stats.count + 1);
      stats.count++;
    });

    return {
      averageRenderTime,
      slowestOperations,
      memoryTrend,
      totalOperations: this.metrics.length,
      storeOperationStats,
    };
  }

  /**
   * Get detailed metrics
   */
  getDetailedMetrics(): {
    metrics: PerformanceMetric[];
    memoryMetrics: MemoryMetric[];
    storeMetrics: StoreMetric[];
  } {
    return {
      metrics: [...this.metrics],
      memoryMetrics: [...this.memoryMetrics],
      storeMetrics: [...this.storeMetrics],
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
    this.memoryMetrics = [];
    this.storeMetrics = [];
  }

  /**
   * Export metrics as JSON
   */
  export(): string {
    return JSON.stringify({
      summary: this.getSummary(),
      details: this.getDetailedMetrics(),
      timestamp: Date.now(),
    }, null, 2);
  }

  private addMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);
    
    // Keep only recent metrics to prevent memory leaks
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics / 2);
    }

    // Log slow operations in development
    if (config.processing.enableDebugMode && metric.duration > 100) {
      console.warn(`Slow operation detected: ${metric.name} took ${metric.duration.toFixed(2)}ms`, metric);
    }
  }

  private startMemoryMonitoring(): void {
    // Check if Performance memory API is available
    if (!('memory' in performance)) {
      return;
    }

    const recordMemory = () => {
      const memoryInfo = (performance as any).memory;
      
      this.memoryMetrics.push({
        usedJSHeapSize: memoryInfo.usedJSHeapSize,
        totalJSHeapSize: memoryInfo.totalJSHeapSize,
        jsHeapSizeLimit: memoryInfo.jsHeapSizeLimit,
        timestamp: Date.now(),
      });

      // Keep only recent memory metrics
      if (this.memoryMetrics.length > 100) {
        this.memoryMetrics = this.memoryMetrics.slice(-50);
      }
    };

    // Record memory usage every 30 seconds
    setInterval(recordMemory, 30000);
    recordMemory(); // Initial measurement
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

// React hook for performance monitoring
export const usePerformanceMonitor = () => {
  return {
    measure: performanceMonitor.measure.bind(performanceMonitor),
    measureAsync: performanceMonitor.measureAsync.bind(performanceMonitor),
    startMeasurement: performanceMonitor.startMeasurement.bind(performanceMonitor),
    getSummary: performanceMonitor.getSummary.bind(performanceMonitor),
    export: performanceMonitor.export.bind(performanceMonitor),
  };
};

// HOC for automatic component performance monitoring
export function withPerformanceMonitoring<P extends object>(
  Component: React.ComponentType<P>,
  displayName?: string
): React.ComponentType<P> {
  const WrappedComponent = (props: P) => {
    const componentName = displayName || Component.displayName || Component.name || 'Component';
    
    return performanceMonitor.measure(
      `render-${componentName}`,
      () => React.createElement(Component, props),
      { componentName }
    );
  };

  WrappedComponent.displayName = `withPerformanceMonitoring(${displayName || Component.displayName || Component.name})`;
  
  return WrappedComponent;
}