import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { MapComponentsProvider } from '@mapcomponents/react-maplibre'
import { validateExportFunctions } from './utils/meshExporter.test'

// Validate mesh export functions on app startup
try {
  validateExportFunctions();
  console.log('🎯 Automatic GLB export functionality is ready!');
} catch (error) {
  console.error('❌ Mesh export validation failed:', error);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MapComponentsProvider>
      <App />
    </MapComponentsProvider>
  </StrictMode>,
)
