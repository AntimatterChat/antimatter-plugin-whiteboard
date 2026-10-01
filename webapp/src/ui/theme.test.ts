// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {renderHook, waitFor} from '@testing-library/react';

import {isDark, parseColor, useBoardTheme} from './theme';

describe('colors', () => {
    test('are read in the forms themes write them', () => {
        expect(parseColor('#ffffff')).toEqual([1, 1, 1]);
        expect(parseColor(' #000 ')).toEqual([0, 0, 0]);
        expect(parseColor('rgb(255, 0, 0)')).toEqual([1, 0, 0]);
        expect(parseColor('rgba(0 0 255 / 0.5)')).toEqual([0, 0, 1]);
        expect(parseColor('purple')).toBeNull();
    });

    test('are dark or light', () => {
        expect(isDark('#313338')).toBe(true);
        expect(isDark('#FFFFFF')).toBe(false);
        expect(isDark('nonsense')).toBe(false);
    });
});

const onDarkTheme = () => useBoardTheme('#1f1f1f');
const onLightTheme = () => useBoardTheme('#ffffff');
const isLight = (result: {current: string}) => () => expect(result.current).toBe('light');

describe('useBoardTheme', () => {
    afterEach(() => {
        delete window.antimatterWebUI;
        document.documentElement.style.removeProperty('--am-main');
    });

    test("follows the user's theme in the classic UI", () => {
        expect(renderHook(onDarkTheme).result.current).toBe('dark');
        expect(renderHook(onLightTheme).result.current).toBe('light');
    });

    test("follows Fusion's own theme under Fusion", async () => {
        window.antimatterWebUI = 'fusion';
        document.documentElement.style.setProperty('--am-main', '#313338');
        const {result} = renderHook(onLightTheme);
        expect(result.current).toBe('dark');

        // Switching Fusion's theme changes the attributes of the page
        document.documentElement.style.setProperty('--am-main', '#FFFFFF');
        await waitFor(isLight(result));
    });
});
