"use strict";

const path = require('path');
var webpack = require("webpack");

module.exports = {
    performance: { hints: false },
    target: 'node',
    entry: './src/main.js',
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'dist')
    }
};
