// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {panelStateOf, parsePanelState} from './panel_state';

describe('the panel state', () => {
    test('names the open board, or the list shown', () => {
        expect(panelStateOf({docId: 'b1', listView: 'mine'})).toBe('board/b1');
        expect(panelStateOf({docId: null, listView: 'mine'})).toBe('list/mine');
        expect(panelStateOf({docId: null, listView: 'favorites'})).toBe('list/favorites');

        // The channel's list is the app's home: no state
        expect(panelStateOf({docId: null, listView: 'channel'})).toBe('');
    });

    test('reads back what it wrote', () => {
        for (const place of [
            {docId: 'abcdefghijklmnopqrstuvwxyz', listView: 'channel' as const},
            {docId: null, listView: 'mine' as const},
            {docId: null, listView: 'favorites' as const},
        ]) {
            expect(parsePanelState(panelStateOf(place))).toEqual(place);
        }
    });

    test("is the channel's list for no state, or one it didn't write", () => {
        expect(parsePanelState(undefined)).toBeNull();
        expect(parsePanelState('')).toBeNull();
        for (const state of ['board', 'board/', 'board/../admin', 'board/b1/card/c1', 'board/a b', 'list/all', 'note/n1', `board/${'a'.repeat(65)}`]) {
            expect(parsePanelState(state)).toBeNull();
        }
    });
});
