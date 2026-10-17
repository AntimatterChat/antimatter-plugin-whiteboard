// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {CSSProperties} from 'react';

// Antimatter ships two web UIs: the classic one and Fusion. Under Fusion, the plugin draws the
// markup of the Fusion mockup (its am- classes, styled by Fusion); under the classic UI, the same
// markup with the plugin's own classic styles. Both UIs say which one is running before plugins
// load.

export type WebUI = 'classic' | 'fusion';

// isFusionUI returns whether the Fusion web UI is running.
export function isFusionUI(): boolean {
    return window.antimatterWebUI === 'fusion' || document.documentElement.dataset.amWebUi === 'fusion';
}

// cx returns the classes of the running UI for the mockup's class names: am-<name> under Fusion,
// amw-<name> (styled by the plugin) under the classic UI. Falsy names are skipped.
export function cx(...names: Array<string | false | null | undefined>): string {
    const prefix = isFusionUI() ? 'am-' : 'amw-';
    return names.filter(Boolean).map((name) => prefix + name).join(' ');
}

// The app's colour in the Fusion UI (its icon in the app rail, .am-whiteboard), which Fusion's cards and the shared
// empty states take from --am-cc: set on the panel and on the cards of shared boards.
export const APP_COLOUR = '#FB923C';
export const APP_COLOUR_STYLE = {'--am-cc': APP_COLOUR} as CSSProperties;
