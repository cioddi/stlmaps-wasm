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

### Dev environment setup

1. Clone this repository
```bash
git clone <repository-url>
cd my-3d-map-app
yarn
yarn dev
```