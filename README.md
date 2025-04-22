> **Disclaimer:** This project was developed with assistance from AI tools including GPT-4o and Claude 3.7.

# 3D Map Generator

A web application for generating 3D terrain and building models from map data. This tool allows you to select an area on a map and export it as a 3D OBJ file that can be used for 3D printing, visualization, or digital elevation modeling.

## Features

- Interactive map interface based on @mapcomponents/react-maplibre
- Select regions of interest using a resizable, rotatable bounding box
- Generate 3D terrain models from digital elevation model (DEM) data
- Automatically include buildings with appropriate heights
- Adjust vertical exaggeration to enhance terrain features
- Preview 3D models directly in the browser
- Download models in OBJ format for use in other applications

## Getting Started

### Prerequisites

- Node.js 18.x or later
- npm 9.x or later
- Rust and Cargo (install via [rustup](https://rustup.rs/))
- wasm-pack (install via [installer](https://rustwasm.github.io/wasm-pack/installer/))

### Dev environment setup

1. Clone this repository
```bash
git clone <repository-url>
cd stlmaps
yarn
yarn dev
```

1. **Architecture Overview**:
   - The application is structured as a monorepo with three main packages:
     - `stlmaps-app`: React-based frontend application
     - `threegis-core`: TypeScript library that interfaces with WASM
     - `threegis-core-wasm`: Rust-based WASM module for heavy processing

2. **WASM Module (`threegis-core-wasm`)**:
   - Written in Rust and compiled to WebAssembly
   - Core processing modules:
     - `vectortile.rs`: Handles vector tile processing
     - `elevation.rs`: Processes elevation data
     - `terrain.rs`: Generates terrain geometry
     - `mvt_parser.rs`: Parses Mapbox Vector Tiles
     - `polygon_geometry.rs`: Processes polygon geometries
     - `cache_manager.rs`: Manages data caching
   - Key functionalities:
     - Vector tile processing and parsing
     - Elevation data processing
     - Geometry generation (buildings, terrain)
     - Coordinate transformations
     - Data caching and management

3. **Core Library (`threegis-core`)**:
   - TypeScript library that provides a bridge between the frontend and WASM
   - Main components:
     - `wasm/`: WASM bridge and initialization
     - `hooks/`: React hooks for WASM functionality
     - `sources/`: Data source handling (e.g., vector tiles)
     - `utils/`: Utility functions
   - Provides hooks like:
     - `useWasm`: WASM initialization and management
     - `useElevationProcessor`: Elevation data processing
     - `useVectorTiles`: Vector tile handling

4. **Frontend Application (`stlmaps-app`)**:
   - React-based user interface
   - Main components:
     - `MapSection`: Displays the map
     - `ModelSection`: Shows the 3D model
     - `BboxSelector`: Allows selecting map areas
     - `GenerateMeshButton`: Triggers 3D model generation
   - Features:
     - Split view for map and 3D model
     - Mobile-responsive design
     - Sidebar for controls and settings
     - Bounding box selection for area extraction

5. **Data Flow**:
   1. User selects an area using the bounding box selector
   2. Frontend requests vector tile data for the selected area
   3. Data is processed through the WASM module:
      - Vector tiles are parsed
      - Elevation data is processed
      - 3D geometry is generated
   4. Results are returned to the frontend
   5. 3D model is rendered in the ModelSection

6. **Migration Status**:
   - The application is in the process of moving processing logic from the frontend to WASM
   - The WASM module is actively being developed with new features
   - Core functionality like vector tile processing and elevation data handling is already in WASM

7. **Key Technical Features**:
   - WebAssembly for high-performance processing
   - Vector tile-based map data
   - 3D model generation from 2D map data
   - Efficient data caching
   - Responsive UI with mobile support
   - TypeScript/React for frontend development
   - Rust for WASM module development

This architecture allows for efficient processing of map data and generation of 3D models while maintaining a responsive user interface. The move to WASM is improving performance by moving heavy computations to a more efficient runtime environment.
