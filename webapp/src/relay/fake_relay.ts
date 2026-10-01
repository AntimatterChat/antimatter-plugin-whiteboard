// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {toBase64} from './base64';
import {RelayError, type DocState, type Update} from './client';
import type {AwarenessEvent, RelayAPI, UpdateEvent} from './connection';

type Client = {
    handleUpdate(event: UpdateEvent): void;
    handleAwareness(event: AwarenessEvent): void;
};

// FakeRelay is an in-memory relay server for tests: it stores the log of one document and sends
// the update events to the connected clients, unless told to drop them.
export default class FakeRelay implements RelayAPI {
    snapshot: Uint8Array | null = null;
    snapshotSeq = 0;
    updates: Update[] = [];
    lastSeq = 0;
    compactAfter = 0;
    clients: Client[] = [];
    dropEvents = false;
    failNext = 0;
    failStatus = 0;
    posts = 0;
    awareness: Array<{clientId: string; data: Uint8Array}> = [];

    connect(connection: Client) {
        this.clients.push(connection);
    }

    async getState(): Promise<DocState> {
        return {snapshot: this.snapshot, snapshotSeq: this.snapshotSeq, updates: [...this.updates], lastSeq: this.lastSeq};
    }

    async getUpdates(docId: string, after: number) {
        if (after < this.snapshotSeq) {
            return {updates: [], reset: true};
        }
        return {updates: this.updates.filter((u) => u.seq > after), reset: false};
    }

    async postUpdate(docId: string, clientId: string, data: Uint8Array) {
        this.posts++;
        if (this.failNext > 0) {
            this.failNext--;
            throw new RelayError('failed', this.failStatus || 503);
        }
        const seq = ++this.lastSeq;
        this.updates.push({seq, data});
        if (!this.dropEvents) {
            for (const client of this.clients) {
                client.handleUpdate({doc_id: docId, client_id: clientId, seq, data: toBase64(data)});
            }
        }
        return {seq, compact: this.compactAfter > 0 && this.updates.length >= this.compactAfter};
    }

    async putSnapshot(docId: string, seq: number, data: Uint8Array) {
        if (seq <= this.snapshotSeq) {
            throw new RelayError('stale', 409);
        }
        this.snapshot = data;
        this.snapshotSeq = seq;
        this.updates = this.updates.filter((u) => u.seq > seq);
        return {};
    }

    async postAwareness(docId: string, clientId: string, data: Uint8Array) {
        this.awareness.push({clientId, data});
        for (const client of this.clients) {
            client.handleAwareness({doc_id: docId, client_id: clientId, data: toBase64(data)});
        }
        return {};
    }
}
