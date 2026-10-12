// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {offline} = require('../../excalidraw_offline_loader');

// The hosts of Excalidraw and its services, and the sites of the embeds: the boards never reach them.
const FORBIDDEN = /["'`]https?:\/\/(?:[a-z0-9-]+\.)*(?:excalidraw\.com|cloudfunctions\.net|firebaseio\.com|esm\.sh|discord\.gg|x\.com|twitter\.com|youtube\.com|vimeo\.com|figma\.com|giphy\.com|reddit\.com)/;

const dist = path.join(__dirname, '../../node_modules/@excalidraw/excalidraw/dist/prod');
const files = fs.readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => path.join(dist, f));
const read = (file: string) => fs.readFileSync(file, 'utf8');
const reachesOut = (code: string) => FORBIDDEN.test(code);
const sources = files.map(read);
const offlineAll = () => sources.map((code) => offline(code) as string);

describe('Excalidraw, made to work offline', () => {
    test('the bundled Excalidraw reaches third parties before', () => {
        expect(sources.some(reachesOut)).toBe(true);
    });

    test('and no longer after', () => {
        const out = offlineAll();
        expect(out.filter(reachesOut)).toEqual([]);
        const all = out.join('\n');

        // The library's "Browse libraries" renders the plugin's note, publishing is gone, fonts stay local
        expect(all).not.toContain('"library-menu-browse-button",href:');
        expect(all).toContain('window.AntimatterWhiteboardLibraryButton()');
        expect(all).toMatch(/!1&&\w+\(\w+\.Item,\{icon:\w+,onSelect:\(\)=>\w+\(!0\),"data-testid":"lib-dropdown--remove"/);
        expect(all).not.toMatch(/push\(new URL\(\w+,\w+\.ASSETS_FALLBACK_URL\)\)/);
        expect(all).toContain('excalidrawLib:"Shared libraries"');
        expect(all).toContain('hint_emptyLibrary:"Select an item on canvas to add it here."');

        // SVG still has its namespaces
        expect(all).toContain('"http://www.w3.org/2000/svg"');
    });

    test('a version of Excalidraw the loader doesn\'t know fails the build', () => {
        const unknown = () => offline('x("a",{className:"library-menu-browse-button",href:somewhere})');
        expect(unknown).toThrow(/Browse libraries/);
        expect(offline('x("a",{className:"library-menu-browse-button",href:somewhere})', {strict: false})).toContain('library-menu-browse-button');
    });
});
