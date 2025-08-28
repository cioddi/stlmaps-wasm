export const developmentConfig = {
  // API Configuration
  api: {
    baseUrl: 'https://cioddi.github.io/stlmaps-wasm/',
    timeout: 15000,
    retryAttempts: 2,
    retryDelay: 2000,
  },

  // Tile Server Configuration
  tileServers: {
    vectorTiles: {
      url: 'https://wms.wheregroup.com/tileserver/tile/world-0-14/{z}/{x}/{y}.pbf',
      maxZoom: 14,
      minZoom: 0,
      attribution: '© OpenStreetMap contributors',
    },
    elevation: {
      url: 'https://wms.wheregroup.com/dem_tileserver/raster_dem/{z}/{x}/{y}.webp',
      maxZoom: 15,
      attribution: '',
    },
  },

  // Processing Configuration
  processing: {
    maxConcurrentRequests: 4,
    chunkSize: 1000,
    timeoutMs: 60000,
    enableDebugMode: true,
    logLevel: 'debug',
  },

  // Rendering Configuration
  rendering: {
    defaultMode: 'performance',
    enableShadows: false,
    antialias: true,
    pixelRatio: Math.min(window.devicePixelRatio, 2),
  },

  // Memory Configuration
  memory: {
    maxGeometryCache: 1000 * 1024 * 1024, // 1000MB
    maxTileCache: 500 * 1024 * 1024, // 500MB
    gcThreshold: 0.8,
  },

  // Feature Flags
  features: {
    enableExperimentalFeatures: true,
    enablePerformanceMonitoring: true,
    enableErrorReporting: true,
  },
} as const;