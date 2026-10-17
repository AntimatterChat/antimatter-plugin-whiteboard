// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import fs from 'fs';
import path from 'path';

// Excalidraw's interface in Fusion's colours (fusion_theme.css): its theme variables, on every .excalidraw container
// (the board's, and those its dialogs and menus are portalled to), light and dark, take Fusion's tokens under the
// Fusion UI only.

const FUSION = 'html[data-am-web-ui="fusion"]';
const css = fs.readFileSync(path.join(__dirname, 'fusion_theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const excalidrawCss = fs.readFileSync(path.resolve(__dirname, '..', '..', 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod', 'index.css'), 'utf8');

type Rule = {selector: string; body: string};
const rules: Rule[] = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((m) => ({selector: m[1].trim(), body: m[2]}));

// The variables of the rule mapping Excalidraw's theme, by name.
const themeRule = rules.find((r) => r.selector === `${FUSION} :is(.excalidraw, .excalidraw.theme--dark)`);
const mapped = new Map(Array.from((themeRule?.body || '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)).map((m) => [m[1], m[2].trim()]));

describe('Excalidraw under the Fusion UI', () => {
    test('every rule applies under the Fusion UI only: the classic UI keeps Excalidraw\'s look', () => {
        expect(rules.length).toBeGreaterThan(0);
        for (const rule of rules) {
            for (const selector of rule.selector.split(/,(?![^(]*\))/)) {
                expect(selector.trim().startsWith(FUSION + ' ')).toBe(true);
            }
        }
    });

    test('the theme variables are set on every .excalidraw container, light and dark alike', () => {
        // As specific as Excalidraw's dark rules (.excalidraw.theme--dark), plus the html attribute: they win in both.
        expect(themeRule).toBeDefined();
        expect(mapped.size).toBeGreaterThan(40);
    });

    test.each([
        ['--island-bg-color', 'var(--am-raise)'],
        ['--popup-bg-color', 'var(--am-raise)'],
        ['--sidebar-bg-color', 'var(--am-raise)'],
        ['--default-bg-color', 'var(--am-main)'],
        ['--input-bg-color', 'var(--am-main)'],
        ['--input-border-color', 'var(--am-line)'],
        ['--dialog-border-color', 'var(--am-line)'],
        ['--default-border-color', 'var(--am-line)'],
        ['--text-primary-color', 'var(--am-text)'],
        ['--color-on-surface', 'var(--am-text)'],
        ['--color-surface-low', 'var(--am-side)'],
        ['--color-surface-high', 'var(--am-raise-2)'],
        ['--color-primary', 'var(--am-matter)'],
        ['--color-primary-light', 'var(--am-matter-soft)'],
        ['--color-danger', 'var(--am-danger)'],
        ['--shadow-island', 'var(--am-shadow)'],
        ['--modal-shadow', 'var(--am-shadow)'],
        ['--ui-font', 'var(--am-font-ui)'],
    ])('%s is %s', (name, value) => {
        expect(mapped.get(name)).toBe(value);
    });

    test('every value comes from Fusion\'s tokens (or is unset), never a colour of its own', () => {
        for (const [name, value] of mapped) {
            if (name === '--button-color') {
                expect(value).toBe('initial');
                continue;
            }
            if ((/^--border-radius-/).test(name)) {
                expect(value).toMatch(/^\d+px$/);
                continue;
            }
            expect(value).toContain('var(--am-');
            expect(value).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
        }
    });

    test('every variable mapped is one Excalidraw defines on .excalidraw (no typo, nothing gone after an upgrade)', () => {
        for (const name of mapped.keys()) {
            if (name === '--button-color') {
                continue;
            }
            expect(excalidrawCss).toContain(name + ':');
        }
    });

    test('leaves the dark theme\'s inversion of the canvas alone, so what\'s drawn keeps its colours', () => {
        expect(mapped.has('--theme-filter')).toBe(false);
        expect(css).not.toContain('--theme-filter');
        expect(css).not.toMatch(/\bfilter\s*:/);
    });

    test('is loaded with the canvas, after Excalidraw\'s own stylesheet', () => {
        const canvas = fs.readFileSync(path.join(__dirname, 'canvas.tsx'), 'utf8');
        const own = canvas.indexOf('\'@excalidraw/excalidraw/index.css\'');
        const fusion = canvas.indexOf('\'./fusion_theme.css\'');
        expect(own).toBeGreaterThan(-1);
        expect(fusion).toBeGreaterThan(own);
    });
});
