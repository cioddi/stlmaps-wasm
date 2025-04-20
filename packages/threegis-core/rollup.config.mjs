import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import wasm from '@rollup/plugin-wasm';
import babel from '@rollup/plugin-babel';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import { readFileSync } from 'fs';

// Read package.json as ESM
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
);

// Define configuration
const config = [
  {
    input: 'src/index.ts',
    output: [
      {
        file: pkg.main,
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: pkg.module,
        format: 'esm',
        sourcemap: true,
      },
    ],
    plugins: [
      // Extract peer dependencies
      peerDepsExternal(),
      
      resolve({
        preferBuiltins: false,
        extensions: ['.ts', '.js', '.mjs', '.wasm'],
      }),
      commonjs(),
      babel({
        presets: ['@babel/preset-react'],
        babelHelpers: 'bundled',
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
      }),
      wasm({
        maxFileSize: 10000000,
      }),
      typescript({
        tsconfig: './tsconfig.json',
      }),
    ],
    // Make sure to include all externals including React and React DOM
    external: ['@threegis/core-wasm', 'react', 'react-dom'],
  },
  {
    input: 'dist/index.d.ts',
    output: [{ file: pkg.types, format: 'esm' }],
    plugins: [dts()],
  },
];

// Filter out the types bundle if in watch mode
export default process.env.ROLLUP_WATCH 
  ? [config[0]] 
  : config;
