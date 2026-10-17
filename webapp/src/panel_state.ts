// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {ListView} from './ui_state';

// Where the whiteboard panel is, as it tells the host (its setPanelState prop) so that "Open in new window" starts
// there: 'board/<id>', 'list/favorites' or 'list/mine'; nothing on the channel's list. It only names what is shown:
// the new window fetches the board again as the person signed in there.
export type PanelPlace = {
    docId: string | null;
    listView: ListView;
};

const DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;
const LIST_VIEWS: ListView[] = ['channel', 'favorites', 'mine'];

// panelStateOf returns the state of a place, '' for the channel's list.
export function panelStateOf(place: PanelPlace): string {
    if (place.docId) {
        return `board/${place.docId}`;
    }
    return place.listView === 'channel' ? '' : `list/${place.listView}`;
}

// parsePanelState returns the place a state names, or null for the channel's list: no state, or one this app
// didn't write (another version's, or a hand-edited address).
export function parsePanelState(state: string | null | undefined): PanelPlace | null {
    if (!state) {
        return null;
    }
    const parts = state.split('/');
    if (parts.length !== 2) {
        return null;
    }
    if (parts[0] === 'board' && DOC_ID.test(parts[1])) {
        return {docId: parts[1], listView: 'channel'};
    }
    if (parts[0] === 'list' && LIST_VIEWS.includes(parts[1] as ListView)) {
        return {docId: null, listView: parts[1] as ListView};
    }
    return null;
}
