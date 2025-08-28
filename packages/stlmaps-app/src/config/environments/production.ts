export const productionConfig = {
  // API Configuration
  api: {
    baseUrl: 'https://api.stlmaps.com',
    timeout: 15000,
    retryAttempts: 2,
    retryDelay: 2000,
  },

  // Tile Server Configuration
  tileServers: {
    vectorTiles: {
      url: 'https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key={accessToken}',
      maxZoom: 14,
      minZoom: 0,
      attribution: '© MapTiler © OpenStreetMap contributors',
    },
    elevation: {
      url: 'https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw?access_token={accessToken}',
      maxZoom: 15,
      attribution: '© Mapbox',
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
    maxGeometryCache: 50 * 1024 * 1024, // 50MB
    maxTileCache: 25 * 1024 * 1024, // 25MB
    gcThreshold: 0.7,
  },

  // Feature Flags
  features: {
    enableExperimentalFeatures: false,
    enablePerformanceMonitoring: true,
    enableErrorReporting: true,
  },
} as const;