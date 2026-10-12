// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

// Antimatter runs without the internet, and its boards never call third parties. Excalidraw links
// to excalidraw.com and its services in a few places: this loader changes its code (from the npm
// package's dist files) so that nothing leaves the server:
// - the "Browse libraries" button of the library, which opens libraries.excalidraw.com, renders
//   window.AntimatterWhiteboardLibraryButton instead: the libraries the admins add, see
//   src/excalidraw/library_note.tsx;
// - publishing the library to libraries.excalidraw.com is removed from the library's menu;
// - the URLs of Excalidraw's services (collaboration, AI, sharing, libraries) are emptied;
// - the fonts are never loaded from esm.sh when they fail to load from the plugin;
// - the library's hint no longer points to the public repository, and the published items (the
//   admins' libraries) are "Shared libraries" in English;
// - the help's links, the social links, the embeds' URLs... any other web address becomes an
//   about:blank one, which goes nowhere.
// webpack.config.js checks the built bundle for the hosts of Excalidraw and its services.

const BROWSE_BUTTON = /(?:\/\*\s*@__PURE__\s*\*\/\s*)?\w+\(\s*"a",\s*\{\s*className:\s*"library-menu-browse-button",\s*href:\s*`[^`]*`,\s*target:\s*"_excalidraw_libraries",\s*children:\s*\w+\(\s*"labels\.libraries"\s*\)\s*,?\s*\}\s*\)/g;
const BROWSE_REPLACEMENT = '(typeof window.AntimatterWhiteboardLibraryButton === "function" ? window.AntimatterWhiteboardLibraryButton() : null)';

const SERVICE_URL = /(VITE_APP_[A-Z0-9_]+:\s*)"https?:\/\/[^"]*"/g;
const FIREBASE_CONFIG = /(VITE_APP_FIREBASE_CONFIG:\s*)'[^']*'/g;

const FONT_FALLBACK = /\w+\.push\(\s*new URL\(\s*\w+,\s*\w+\.ASSETS_FALLBACK_URL\s*\)\s*\)/g;

const PUBLISH_ITEM = /(\w+)(\s*&&\s*(?:\/\*\s*@__PURE__\s*\*\/\s*)?\w+\(\s*[\w.]+\.Item,\s*\{\s*icon:\s*\w+,\s*onSelect:\s*\(\)\s*=>\s*\w+\(\s*(?:!0|true)\s*\),\s*"data-testid":\s*"lib-dropdown--remove")/g;

// The hint of an empty library, which points to the public repository: the one of a library with
// shared items only, in every language.
const EMPTY_HINT = /hint_emptyLibrary:\s*("(?:[^"\\]|\\.)*"),(\s*)hint_emptyPrivateLibrary:\s*("(?:[^"\\]|\\.)*")/g;

// Web addresses in string and template literals, but the XML namespaces of SVG.
const WEB_ADDRESS = /(["'`])https?:\/\/(?!www\.w3\.org\/)/g;

// The patches each file of the dist must take (once, or more), found by what the file holds.
const PATCHES = [
    {name: 'the "Browse libraries" button', when: 'library-menu-browse-button', pattern: BROWSE_BUTTON, replacement: BROWSE_REPLACEMENT},
    {name: 'the URLs of the services', when: 'VITE_APP_LIBRARY_URL', pattern: SERVICE_URL, replacement: '$1""'},
    {name: 'the configuration of Firebase', when: 'VITE_APP_FIREBASE_CONFIG', pattern: FIREBASE_CONFIG, replacement: "$1'{}'"},
    {name: 'the fallback of the fonts', when: 'ASSETS_FALLBACK_URL)', pattern: FONT_FALLBACK, replacement: '0'},
    {name: 'publishing the library', when: '"lib-dropdown--remove"', pattern: PUBLISH_ITEM, replacement: '!1$2'},
    {name: 'the name of the published items', when: 'excalidrawLib: "Excalidraw Library"', pattern: /excalidrawLib: "Excalidraw Library"/g, replacement: 'excalidrawLib: "Shared libraries"'},
    {name: 'the name of the published items', when: 'excalidrawLib:"Excalidraw Library"', pattern: /excalidrawLib:"Excalidraw Library"/g, replacement: 'excalidrawLib:"Shared libraries"'},
    {name: 'the hint of an empty library', when: 'hint_emptyPrivateLibrary', pattern: EMPTY_HINT, replacement: 'hint_emptyLibrary:$3,$2hint_emptyPrivateLibrary:$3', optional: true},
];

function offline(source, {strict = true, warn = () => null} = {}) {
    let out = source;
    for (const patch of PATCHES) {
        if (!out.includes(patch.when)) {
            continue;
        }
        const before = out;
        out = out.replace(patch.pattern, patch.replacement);
        if (out === before && !patch.optional) {
            const message = `excalidraw_offline_loader: ${patch.name} not found: update the loader for this version of Excalidraw`;
            if (strict) {
                throw new Error(message);
            }
            warn(message);
        }
    }
    return out.replace(WEB_ADDRESS, '$1about:blank#');
}

module.exports = function excalidrawOffline(source) {
    if (!this.resourcePath.endsWith('.js')) {
        return source;
    }

    // The production build must take every patch; the development one (Excalidraw's dev dist) warns.
    return offline(source, {strict: this.mode !== 'development', warn: (m) => this.emitWarning(new Error(m))});
};

module.exports.offline = offline;
