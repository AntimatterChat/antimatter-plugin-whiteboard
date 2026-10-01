// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {fromBase64, toBase64} from './base64';

describe('base64', () => {
    test('round-trips binary data', () => {
        const data = new Uint8Array(100000);
        for (let i = 0; i < data.length; i++) {
            data[i] = (i * 31) % 256;
        }
        const encoded = toBase64(data);
        expect(encoded.slice(0, 8)).toBe(btoa(String.fromCharCode(0, 31, 62, 93, 124, 155)));
        expect(fromBase64(encoded)).toEqual(data);
    });

    test('handles empty data', () => {
        expect(toBase64(new Uint8Array())).toBe('');
        expect(fromBase64('')).toEqual(new Uint8Array());
    });
});
