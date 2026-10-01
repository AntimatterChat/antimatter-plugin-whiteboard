// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

/* eslint-disable no-underscore-dangle, prefer-const, @typescript-eslint/no-unused-vars, camelcase */

import manifest from './manifest';

// Set by webpack: where the chunks loaded on demand are
declare let __webpack_public_path__: string;

// The server serves the files of the webapp bundle next to it: the chunks loaded on demand
// (Excalidraw) and Excalidraw's fonts, which it would load from a CDN otherwise.
const assets = `${window.basename || ''}/static/plugins/${manifest.id}/`;

__webpack_public_path__ = assets;
window.EXCALIDRAW_ASSET_PATH = assets;
