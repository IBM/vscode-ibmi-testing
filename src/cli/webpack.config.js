//@ts-check

'use strict';

const path = require('path');
const webpack = require(`webpack`);

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node', // VS Code extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
  mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')
  node: {
    __dirname: false // leave the __dirname-behaviour intact
  },
  context: path.join(__dirname),
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      { test: /\.([cm]?ts|tsx)$/, loader: "ts-loader", options: { allowTsInNodeModules: true } }
    ]
  },
  entry: {
    extension: `./src/index.ts`,
  },
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, 'dist'),
    filename: path.join(`index.js`),
    libraryTarget: 'commonjs2'
  },
  devtool: `source-map`,
  plugins: [
    new webpack.BannerPlugin({banner: `#! /usr/bin/env node`, raw: true}),
    new webpack.IgnorePlugin({ resourceRegExp: /(cpu-features|sshcrypto\.node)/u })
  ]
};
module.exports = [extensionConfig];