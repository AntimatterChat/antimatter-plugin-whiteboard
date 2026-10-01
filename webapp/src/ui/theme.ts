// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {useEffect, useState} from 'react';

import {isFusionUI} from './web_ui';

// parseColor returns the red, green and blue of a CSS color written as #rgb, #rrggbb or rgb(a)(),
// from 0 to 1, or null.
export function parseColor(color: string): [number, number, number] | null {
    const value = color.trim();
    let hex = value.startsWith('#') ? value.slice(1) : '';
    if ((/^[0-9a-f]{3}$/i).test(hex)) {
        hex = hex.split('').map((c) => c + c).join('');
    }
    if ((/^[0-9a-f]{6}$/i).test(hex)) {
        return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    }
    const rgb = (/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i).exec(value);
    if (rgb) {
        return [rgb[1], rgb[2], rgb[3]].map((c) => Number(c) / 255) as [number, number, number];
    }
    return null;
}

// isDark returns whether a color is dark, false if it can't be read.
export function isDark(color: string): boolean {
    const rgb = parseColor(color);
    if (!rgb) {
        return false;
    }
    const [r, g, b] = rgb;
    return ((0.2126 * r) + (0.7152 * g) + (0.0722 * b)) < 0.5;
}

// fusionBackground returns the background of Fusion's panels, from its theme tokens.
function fusionBackground(): string {
    return getComputedStyle(document.documentElement).getPropertyValue('--am-main');
}

// useBoardTheme returns the theme Excalidraw takes: the one of the panel it's drawn on. Fusion has
// its own themes, chosen apart from the user's theme (dark, light, or the system's): under Fusion
// it follows them, as they change.
export function useBoardTheme(centerChannelBg: string): 'light' | 'dark' {
    const fusion = isFusionUI();
    const [fusionDark, setFusionDark] = useState(() => fusion && isDark(fusionBackground()));

    useEffect(() => {
        if (!fusion) {
            return () => null;
        }
        const update = () => setFusionDark(isDark(fusionBackground()));
        update();
        const observer = new MutationObserver(update);
        observer.observe(document.documentElement, {attributes: true});
        const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
        scheme?.addEventListener?.('change', update);
        return () => {
            observer.disconnect();
            scheme?.removeEventListener?.('change', update);
        };
    }, [fusion]);

    if (fusion && fusionBackground().trim()) {
        return fusionDark ? 'dark' : 'light';
    }
    return isDark(centerChannelBg) ? 'dark' : 'light';
}
