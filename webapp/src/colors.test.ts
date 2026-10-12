// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {remoteColor, userColor} from './colors';

describe('remoteColor', () => {
    it('keeps hex colors', () => {
        expect(remoteColor('#22D3EE')).toBe('#22D3EE');
        expect(remoteColor(userColor('someone'))).toBe(userColor('someone'));
    });

    it('replaces anything else', () => {
        expect(remoteColor('url(https://example.com/t.png)')).toBe('#F97316');
        expect(remoteColor('red; background: url(x)')).toBe('#F97316');
        expect(remoteColor(null)).toBe('#F97316');
    });
});
