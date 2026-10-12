// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {isDocId} from './client';

describe('isDocId', () => {
    it('accepts document IDs only', () => {
        expect(isDocId('abcdefghijklmnopqrstuvwxyz')).toBe(true);
        expect(isDocId('../../../api/v4/users/me?x')).toBe(false);
        expect(isDocId('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(false);
        expect(isDocId(42)).toBe(false);
    });
});
