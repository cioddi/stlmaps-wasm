# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

STLMaps is a 3D Map Generator web application that converts map data into 3D models for printing or visualization. It uses a monorepo architecture with React frontend and Rust/WASM backend processing.

## Commands

### Development
- `npm run dev` - Start development environment (serves at localhost:5173)
- `npm run build` - Build all packages with turbo
- `npm run lint` - Lint all packages
- `npm run format` - Format code with prettier

### Package-specific commands
- WASM package: `npm run dev` in `packages/threegis-core-wasm/` for hot rebuild
- App testing: Individual packages have their own test scripts

## Architecture

### Monorepo Structure
- **stlmaps-app**: React frontend with 3D viewer and map interface
- **threegis-core**: TypeScript bridge library between frontend and WASM
- **threegis-core-wasm**: Rust WebAssembly module for heavy processing

### Key Processing Pipeline
1. User selects map area via bounding box
2. Vector tile data fetched for selected region
3. WASM module processes:
   - Vector tiles → parsed geometries
   - Elevation data → terrain mesh
   - Buildings → 3D extrusions
4. Results returned to frontend for 3D rendering/export

### WASM Module Core Files
- `vectortile.rs`: Vector tile processing and parsing
- `elevation.rs`: Digital elevation model processing
- `terrain.rs`: 3D terrain geometry generation
- `polygon_geometry.rs`: Building/polygon extrusion
- `mvt_parser.rs`: Mapbox Vector Tile format parsing
- `cache_manager.rs`: Data caching system

### Frontend Architecture
- Uses zustand for state management
- Three.js for 3D rendering in ModelSection
- MapLibre for 2D map display
- Terra-draw for bounding box selection
- Split view: MapSection (left) + ModelSection (right)

### Data Flow
- Frontend hooks (`useWasm`, `useElevationProcessor`, `useVectorTiles`) manage WASM integration
- Worker threads handle heavy computations
- Caching system optimizes repeated requests

## Development Notes

### WASM Development
- Requires Rust toolchain and wasm-pack
- Use `RUSTFLAGS="-C target-feature=+bulk-memory"` for builds
- WASM package auto-rebuilds on Rust file changes in dev mode

### TypeScript Integration
- Strict typing enforced across all packages
- WASM types auto-generated in `pkg/` directory
- Custom hooks provide typed WASM interfaces

### Build Dependencies
- WASM package must build before core library
- Core library must build before app
- Turbo handles dependency orchestration

### Migration Context
The codebase is actively migrating processing logic from frontend JavaScript to Rust/WASM for performance. Some functionality may exist in both implementations during transition.