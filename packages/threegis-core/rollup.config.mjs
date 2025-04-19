import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import wasm from '@rollup/plugin-wasm';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

export default [
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
      resolve({
        preferBuiltins: false,
      }),
      commonjs(),
      wasm({
        // This tells Rollup to include the wasm files as base64-encoded strings
        maxFileSize: 10000000, // Allow larger WASM files (10MB)
      }),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: true,
        declarationDir: 'dist',
        outDir: 'dist',
      }),
    ],
    external: Object.keys(pkg.dependencies || {}).filter(
      dep => dep !== '@threegis/core-wasm'
    ),
  },
  // Only include the dts bundle in production build, not in watch mode
  process.env.ROLLUP_WATCH ? null : {
    input: 'dist/index.d.ts',
    output: [{ file: pkg.types, format: 'esm' }],
    plugins: [dts()],
  },
].filter(Boolean);
