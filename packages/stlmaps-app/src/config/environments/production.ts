export const productionConfig = {
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
    maxConcurrentRequests: 2,
    chunkSize: 500,
    timeoutMs: 30000,
    enableDebugMode: false,
    logLevel: 'warn',
  },

  // Rendering Configuration
  rendering: {
    defaultMode: 'performance',
    enableShadows: false,
    antialias: false,
    pixelRatio: Math.min(window.devicePixelRatio, 1.5),
  },

  // Memory Configuration
  memory: {
    maxGeometryCache: 1000 * 1024 * 1024, // 1000MB
    maxTileCache: 500 * 1024 * 1024, // 500MB
    gcThreshold: 0.7,
  },

  // Feature Flags
  features: {
    enableExperimentalFeatures: false,
    enablePerformanceMonitoring: true,
    enableErrorReporting: true,
  },
} as const;