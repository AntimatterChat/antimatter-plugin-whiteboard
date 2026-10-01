// Copyright (c) 2019-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

var fs = require('fs');
var path = require('path');

// Excalidraw loads its fonts from window.EXCALIDRAW_ASSET_PATH (src/public_path.ts), or from a CDN.
// The plugin ships them next to the bundle, so that boards work without access to the internet.
class CopyExcalidrawFonts {
    apply(compiler) {
        compiler.hooks.afterEmit.tap('CopyExcalidrawFonts', (compilation) => {
            const fonts = path.join(__dirname, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts');
            fs.cpSync(fonts, path.join(compilation.outputOptions.path, 'fonts'), {recursive: true});
        });
    }
}

module.exports = {
    entry: [
        './src/index.tsx',
    ],
    resolve: {
        modules: [
            'src',
            'node_modules',
            path.resolve(__dirname),
        ],
        extensions: ['*', '.js', '.jsx', '.ts', '.tsx'],
    },
    module: {
        rules: [
            {

                // Excalidraw's dependencies import modules without their extension
                test: /\.m?js$/,
                include: /node_modules/,
                resolve: {fullySpecified: false},
            },
            {
                test: /\.(js|jsx|ts|tsx)$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        cacheDirectory: true,

                        // Babel configuration is in babel.config.js because jest requires it to be there.
                    },
                },
            },
            {

                // Excalidraw's sizes in rem, for a 16px root font size
                test: /node_modules[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/].*\.(css|js)$/,
                enforce: 'pre',
                use: path.resolve(__dirname, 'rem_to_px_loader.js'),
            },
            {
                test: /\.css$/,
                use: [
                    {
                        loader: 'style-loader',
                    },
                    {
                        loader: 'css-loader',
                    },
                ],
            },
        ],
    },
    externals: {
        react: 'React',
        'react-dom': 'ReactDOM',
        'react-dom/client': 'ReactDOM',
        'react/jsx-runtime': 'ReactJSXRuntime',
        'react/jsx-dev-runtime': 'ReactJSXDevRuntime',
        redux: 'Redux',
        'react-redux': 'ReactRedux',
        'react-intl': 'ReactIntl',
    },
    output: {
        path: path.join(__dirname, '/dist'),

        // Set at runtime, see src/public_path.ts
        publicPath: '/',
        filename: 'main.js',
        chunkFilename: '[name].[contenthash:8].js',
        clean: true,
    },
    plugins: [new CopyExcalidrawFonts()],
    performance: {

        // Excalidraw is loaded on demand, in its own chunks
        hints: false,
    },
};
