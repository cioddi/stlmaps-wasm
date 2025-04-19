const resolve = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const typescript = require('@rollup/plugin-typescript');
const dts = require('rollup-plugin-dts');
const wasm = require('@rollup/plugin-wasm');

const pkg = require('./package.json');

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
      resolve({
        preferBuiltins: false,
        extensions: ['.ts', '.js', '.mjs', '.wasm'],
      }),
      commonjs(),
      wasm({
        maxFileSize: 10000000,
      }),
      typescript({
        tsconfig: './tsconfig.json',
      }),
    ],
    external: ['@threegis/core-wasm'],
  },
  {
    input: 'dist/index.d.ts',
    output: [{ file: pkg.types, format: 'esm' }],
    plugins: [dts()],
  },
];

// Filter out the types bundle if in watch mode
module.exports = process.env.ROLLUP_WATCH 
  ? [config[0]] 
  : config;
