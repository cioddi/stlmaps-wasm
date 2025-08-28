export const developmentConfig = {
  // API Configuration
  api: {
    baseUrl: 'http://localhost:3000',
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 1000,
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
    maxGeometryCache: 100 * 1024 * 1024, // 100MB
    maxTileCache: 50 * 1024 * 1024, // 50MB
    gcThreshold: 0.8,
  },

  // Feature Flags
  features: {
    enableExperimentalFeatures: true,
    enablePerformanceMonitoring: true,
    enableErrorReporting: true,
  },
} as const;