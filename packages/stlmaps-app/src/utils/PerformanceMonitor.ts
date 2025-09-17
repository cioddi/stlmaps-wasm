/**
 * Performance Monitor
 * Tracks and analyzes layer processing performance and CPU utilization
 * Validates that true parallelization is achieved
 */

// ================================================================================
// Types and Interfaces
// ================================================================================

export interface PerformanceMetrics {
  timestamp: number;
  cpuUsage: number;
  memoryUsage: number;
  activeWorkers: number;
  totalTasks: number;
  completedTasks: number;
}

export interface LayerPerformanceData {
  layerName: string;
  startTime: number;
  endTime: number;
  processingTimeMs: number;
  vertexCount: number;
  geometryCount: number;
  workerId?: string;
  contextId?: string;
  wasmInstanceId?: string;
}

export interface ParallelizationAnalysis {
  efficiency: number; // 0-100%
  theoreticalSpeedup: number;
  actualSpeedup: number;
  parallelOverhead: number;
  bottleneckDetected: boolean;
  bottleneckReason?: string;
  cpuUtilization: number;
  recommendedOptimizations: string[];
}

export interface ProcessingSession {
  sessionId: string;
  startTime: number;
  endTime?: number;
  totalLayers: number;
  terrainProcessingTime: number;
  layerData: LayerPerformanceData[];
  metrics: PerformanceMetrics[];
  analysis?: ParallelizationAnalysis;
}

// ================================================================================
// Performance Monitor Class
// ================================================================================

export class PerformanceMonitor {
  private static instance: PerformanceMonitor | null = null;
  private currentSession: ProcessingSession | null = null;
  private metricsInterval: number | null = null;
  private perfObserver: PerformanceObserver | null = null;

  private constructor() {
    this.setupPerformanceObserver();
  }

  public static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  // ================================================================================
  // Session Management
  // ================================================================================

  startSession(totalLayers: number): string {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.currentSession = {
      sessionId,
      startTime: performance.now(),
      totalLayers,
      terrainProcessingTime: 0,
      layerData: [],
      metrics: []
    };

    // Start collecting metrics every 100ms
    this.startMetricsCollection();

    console.log(`🔍 Performance monitoring started for session: ${sessionId}`);

    return sessionId;
  }

  endSession(): ProcessingSession | null {
    if (!this.currentSession) {
      console.warn('No active performance monitoring session');
      return null;
    }

    this.currentSession.endTime = performance.now();
    this.stopMetricsCollection();

    // Analyze the session
    this.currentSession.analysis = this.analyzeParallelization(this.currentSession);

    const session = this.currentSession;
    this.currentSession = null;

    console.log('📊 Performance monitoring session completed:', session.analysis);

    return session;
  }

  // ================================================================================
  // Data Collection
  // ================================================================================

  recordTerrainProcessing(processingTimeMs: number): void {
    if (this.currentSession) {
      this.currentSession.terrainProcessingTime = processingTimeMs;
    }
  }

  recordLayerProcessing(data: Omit<LayerPerformanceData, 'processingTimeMs'>): void {
    if (!this.currentSession) {
      return;
    }

    const processingTimeMs = data.endTime - data.startTime;

    const layerData: LayerPerformanceData = {
      ...data,
      processingTimeMs
    };

    this.currentSession.layerData.push(layerData);

    console.log(`⏱️ Layer "${data.layerName}" processed in ${processingTimeMs.toFixed(1)}ms`);
  }

  private startMetricsCollection(): void {
    this.metricsInterval = window.setInterval(() => {
      this.collectCurrentMetrics();
    }, 100);
  }

  private stopMetricsCollection(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  private collectCurrentMetrics(): void {
    if (!this.currentSession) {
      return;
    }

    const metrics: PerformanceMetrics = {
      timestamp: performance.now(),
      cpuUsage: this.estimateCPUUsage(),
      memoryUsage: this.getMemoryUsage(),
      activeWorkers: this.getActiveWorkerCount(),
      totalTasks: this.currentSession.totalLayers,
      completedTasks: this.currentSession.layerData.length
    };

    this.currentSession.metrics.push(metrics);
  }

  // ================================================================================
  // Analysis Functions
  // ================================================================================

  private analyzeParallelization(session: ProcessingSession): ParallelizationAnalysis {
    const layerData = session.layerData;

    if (layerData.length === 0) {
      return {
        efficiency: 0,
        theoreticalSpeedup: 1,
        actualSpeedup: 1,
        parallelOverhead: 0,
        bottleneckDetected: true,
        bottleneckReason: 'No layer data available',
        cpuUtilization: 0,
        recommendedOptimizations: ['Check layer processing implementation']
      };
    }

    // Calculate timing metrics
    const sequentialTime = layerData.reduce((sum, layer) => sum + layer.processingTimeMs, 0);
    const parallelTime = this.calculateParallelTime(layerData);
    const actualSpeedup = sequentialTime / parallelTime;

    // Calculate theoretical speedup (based on number of CPU cores)
    const maxCores = navigator.hardwareConcurrency || 4;
    const theoreticalSpeedup = Math.min(layerData.length, maxCores);

    // Calculate efficiency
    const efficiency = (actualSpeedup / theoreticalSpeedup) * 100;

    // Calculate CPU utilization
    const avgCpuUsage = this.calculateAverageCPUUsage(session.metrics);

    // Analyze bottlenecks
    const bottleneckAnalysis = this.analyzeBottlenecks(layerData, session.metrics);

    // Generate recommendations
    const recommendations = this.generateOptimizationRecommendations(
      efficiency,
      avgCpuUsage,
      bottleneckAnalysis,
      layerData
    );

    return {
      efficiency,
      theoreticalSpeedup,
      actualSpeedup,
      parallelOverhead: parallelTime - (sequentialTime / maxCores),
      bottleneckDetected: bottleneckAnalysis.detected,
      bottleneckReason: bottleneckAnalysis.reason,
      cpuUtilization: avgCpuUsage,
      recommendedOptimizations: recommendations
    };
  }

  private calculateParallelTime(layerData: LayerPerformanceData[]): number {
    if (layerData.length === 0) return 0;

    // Sort by start time
    const sortedLayers = [...layerData].sort((a, b) => a.startTime - b.startTime);

    // Find the earliest start and latest end
    const earliestStart = sortedLayers[0].startTime;
    const latestEnd = Math.max(...sortedLayers.map(layer => layer.endTime));

    return latestEnd - earliestStart;
  }

  private calculateAverageCPUUsage(metrics: PerformanceMetrics[]): number {
    if (metrics.length === 0) return 0;

    const sum = metrics.reduce((acc, metric) => acc + metric.cpuUsage, 0);
    return sum / metrics.length;
  }

  private analyzeBottlenecks(
    layerData: LayerPerformanceData[],
    metrics: PerformanceMetrics[]
  ): { detected: boolean; reason?: string } {
    // Check for memory bottlenecks
    const maxMemoryUsage = Math.max(...metrics.map(m => m.memoryUsage));
    if (maxMemoryUsage > 80) {
      return {
        detected: true,
        reason: 'High memory usage detected (>80%). Consider reducing WASM context count or geometry complexity.'
      };
    }

    // Check for uneven layer distribution
    const processingTimes = layerData.map(l => l.processingTimeMs);
    const avgTime = processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length;
    const maxTime = Math.max(...processingTimes);

    if (maxTime > avgTime * 3) {
      return {
        detected: true,
        reason: 'Uneven layer processing times detected. Some layers take significantly longer than others.'
      };
    }

    // Check for worker underutilization
    const avgActiveWorkers = metrics.reduce((sum, m) => sum + m.activeWorkers, 0) / metrics.length;
    const maxWorkers = navigator.hardwareConcurrency || 4;

    if (avgActiveWorkers < maxWorkers * 0.5) {
      return {
        detected: true,
        reason: 'Low worker utilization detected. Consider increasing concurrent layer processing.'
      };
    }

    return { detected: false };
  }

  private generateOptimizationRecommendations(
    efficiency: number,
    cpuUtilization: number,
    bottleneck: { detected: boolean; reason?: string },
    layerData: LayerPerformanceData[]
  ): string[] {
    const recommendations: string[] = [];

    if (efficiency < 50) {
      recommendations.push('Low parallelization efficiency. Consider optimizing layer processing algorithms.');
    }

    if (cpuUtilization < 60) {
      recommendations.push('Low CPU utilization. Increase worker count or reduce synchronization overhead.');
    }

    if (bottleneck.detected && bottleneck.reason) {
      recommendations.push(bottleneck.reason);
    }

    if (layerData.length < 4) {
      recommendations.push('Few layers to process. Consider batching smaller layers or reducing parallel overhead.');
    }

    // Check for layer complexity variations
    const complexityVariation = this.calculateComplexityVariation(layerData);
    if (complexityVariation > 0.5) {
      recommendations.push('High variation in layer complexity. Consider load balancing or layer grouping strategies.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Performance appears optimal for current workload.');
    }

    return recommendations;
  }

  private calculateComplexityVariation(layerData: LayerPerformanceData[]): number {
    if (layerData.length === 0) return 0;

    const vertexCounts = layerData.map(l => l.vertexCount);
    const avg = vertexCounts.reduce((sum, count) => sum + count, 0) / vertexCounts.length;
    const variance = vertexCounts.reduce((sum, count) => sum + Math.pow(count - avg, 2), 0) / vertexCounts.length;

    return Math.sqrt(variance) / avg;
  }

  // ================================================================================
  // Utility Functions
  // ================================================================================

  private estimateCPUUsage(): number {
    // Simple CPU usage estimation based on timing
    // In a real implementation, you might use more sophisticated methods
    const start = performance.now();
    let iterations = 0;
    const duration = 10; // 10ms sample

    while (performance.now() - start < duration) {
      iterations++;
    }

    // Normalize to a percentage (this is a rough estimation)
    const maxIterations = 100000; // Baseline on idle system
    return Math.min(100, Math.max(0, 100 - (iterations / maxIterations) * 100));
  }

  private getMemoryUsage(): number {
    if ('memory' in performance) {
      const memInfo = (performance as any).memory;
      const usedMB = memInfo.usedJSHeapSize / (1024 * 1024);
      const limitMB = memInfo.jsHeapSizeLimit / (1024 * 1024);
      return (usedMB / limitMB) * 100;
    }
    return 0;
  }

  private getActiveWorkerCount(): number {
    // This would need to be updated by the context pool
    // For now, return an estimate
    return Math.min(navigator.hardwareConcurrency || 4, 8);
  }

  private setupPerformanceObserver(): void {
    if ('PerformanceObserver' in window) {
      try {
        this.perfObserver = new PerformanceObserver((list) => {
          // Handle performance entries if needed
        });

        this.perfObserver.observe({ entryTypes: ['measure', 'navigation'] });
      } catch (error) {
        console.warn('Performance Observer not available:', error);
      }
    }
  }

  // ================================================================================
  // Public Utility Methods
  // ================================================================================

  getCurrentSession(): ProcessingSession | null {
    return this.currentSession;
  }

  logPerformanceSummary(session: ProcessingSession): void {
    if (!session.analysis) {
      console.warn('No analysis data available for session');
      return;
    }

    const analysis = session.analysis;

    console.group('🚀 Performance Analysis Summary');
    console.log(`Efficiency: ${analysis.efficiency.toFixed(1)}%`);
    console.log(`Actual Speedup: ${analysis.actualSpeedup.toFixed(2)}x`);
    console.log(`Theoretical Speedup: ${analysis.theoreticalSpeedup.toFixed(2)}x`);
    console.log(`CPU Utilization: ${analysis.cpuUtilization.toFixed(1)}%`);

    if (analysis.bottleneckDetected) {
      console.warn(`⚠️ Bottleneck: ${analysis.bottleneckReason}`);
    }

    console.log('🔧 Recommendations:');
    analysis.recommendedOptimizations.forEach((rec, index) => {
      console.log(`  ${index + 1}. ${rec}`);
    });

    console.groupEnd();
  }

  // Cleanup
  destroy(): void {
    this.stopMetricsCollection();

    if (this.perfObserver) {
      this.perfObserver.disconnect();
      this.perfObserver = null;
    }

    PerformanceMonitor.instance = null;
  }
}

// ================================================================================
// Singleton Export
// ================================================================================

export const performanceMonitor = PerformanceMonitor.getInstance();