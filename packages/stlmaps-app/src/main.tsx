import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { MapComponentsProvider } from '@mapcomponents/react-maplibre'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MapComponentsProvider>
      <App />
    </MapComponentsProvider>
  </StrictMode>,
)
