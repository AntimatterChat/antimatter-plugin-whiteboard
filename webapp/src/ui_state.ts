// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {useSyncExternalStore} from 'react';

// The board open in the panel, shared by the panel and the cards of shared boards.
let openDocId: string | null = null;
let showPanel: () => void = () => null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function setOpenDoc(docId: string | null) {
    if (openDocId !== docId) {
        openDocId = docId;
        listeners.forEach((l) => l());
    }
}

export function useOpenDoc() {
    return useSyncExternalStore(subscribe, () => openDocId);
}

// The list shows the channel's boards or the user's own ones, as the todo app does.
export type ListView = 'channel' | 'mine';
let listView: ListView = 'channel';

export function setListView(view: ListView) {
    if (listView !== view) {
        listView = view;
        listeners.forEach((l) => l());
    }
}

export function useListView() {
    return useSyncExternalStore(subscribe, () => listView);
}

// setShowPanel sets how to show the whiteboard panel (the right-hand sidebar of the plugin).
export function setShowPanel(show: () => void) {
    showPanel = show;
}

// openBoard shows a board in the whiteboard panel.
export function openBoard(docId: string) {
    setOpenDoc(docId);
    showPanel();
}
