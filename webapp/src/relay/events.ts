// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {Doc} from './client';
import type {AwarenessEvent, UpdateEvent} from './connection';

// The websocket events of the relay, sent by the server as custom_<plugin id>_<event>.
export const RelayEvents = {
    update: 'update',
    awareness: 'awareness',
    reset: 'doc_reset',
    created: 'doc_created',
    updated: 'doc_updated',
    deleted: 'doc_deleted',
} as const;

export type DocChange = {event: 'created' | 'updated' | 'deleted'; doc: Omit<Doc, 'can_edit' | 'can_delete'>};

export interface DocListener {
    docId: string;
    handleUpdate(event: UpdateEvent): void;
    handleAwareness(event: AwarenessEvent): void;
    reload(): void;
    catchUp(): void;
}

// RelayEventBus routes the websocket events to the open documents and to the lists of documents.
export class RelayEventBus {
    private docs = new Set<DocListener>();
    private lists = new Set<(change: DocChange) => void>();

    addDoc(listener: DocListener) {
        this.docs.add(listener);
        return () => {
            this.docs.delete(listener);
        };
    }

    addListListener(listener: (change: DocChange) => void) {
        this.lists.add(listener);
        return () => {
            this.lists.delete(listener);
        };
    }

    private forDoc(docId: unknown, fn: (listener: DocListener) => void) {
        for (const listener of this.docs) {
            if (listener.docId === docId) {
                fn(listener);
            }
        }
    }

    // handle dispatches a relay websocket event, given its name without the plugin prefix.
    handle(event: string, data: Record<string, unknown>) {
        switch (event) {
        case RelayEvents.update:
            this.forDoc(data.doc_id, (l) => l.handleUpdate(data as UpdateEvent));
            break;
        case RelayEvents.awareness:
            this.forDoc(data.doc_id, (l) => l.handleAwareness(data as AwarenessEvent));
            break;
        case RelayEvents.reset:
            this.forDoc(data.doc_id, (l) => l.reload());
            break;
        case RelayEvents.created:
        case RelayEvents.updated:
        case RelayEvents.deleted: {
            let doc;
            try {
                doc = JSON.parse(String(data.doc));
            } catch {
                return;
            }
            const change = {event: event.replace('doc_', '') as DocChange['event'], doc};
            for (const listener of this.lists) {
                listener(change);
            }
            break;
        }
        }
    }

    // reconnected catches up the open documents after the websocket reconnected.
    reconnected() {
        for (const listener of this.docs) {
            listener.catchUp();
        }
    }
}
