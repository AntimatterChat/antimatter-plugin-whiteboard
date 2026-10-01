// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {fromBase64} from './base64';
import {RelayError, type AppendResult, type DocState, type Update} from './client';
import SeqTracker from './seq_tracker';

// The part of RelayClient a connection uses.
export interface RelayAPI {
    getState(docId: string): Promise<DocState>;
    getUpdates(docId: string, after: number): Promise<{updates: Update[]; reset: boolean}>;
    postUpdate(docId: string, clientId: string, data: Uint8Array): Promise<AppendResult>;
    putSnapshot(docId: string, seq: number, data: Uint8Array): Promise<unknown>;
    postAwareness(docId: string, clientId: string, data: Uint8Array, keepalive?: boolean): Promise<unknown>;
}

export type SyncStatus = 'loading' | 'saving' | 'saved' | 'offline' | 'error';

// The websocket events of the relay, as received from the server.
export type UpdateEvent = {doc_id: string; client_id: string; seq: number; data?: string};
export type AwarenessEvent = {doc_id: string; client_id: string; data: string};

export type ConnectionHandlers = {

    // applyRemote applies remote content to the local document: the snapshot and the updates of the
    // log, received in any order, some more than once.
    applyRemote(data: Uint8Array): void;

    // merge merges local updates into one, to send them together.
    merge(updates: Uint8Array[]): Uint8Array;

    // snapshot returns the whole local document, to compact the log. Only for documents the
    // clients compact.
    snapshot?(): Uint8Array;

    applyAwareness?(clientId: string, data: Uint8Array): void;
    onStatus?(status: SyncStatus, error?: Error): void;

    // onReadOnly is called when the server refuses an update because the user can't edit anymore.
    onReadOnly?(): void;
};

export type ConnectionOptions = {
    batchDelay?: number;
    catchUpDelay?: number;
    maxRetryDelay?: number;
};

// Statuses that won't succeed when retried: the update is dropped.
const permanentFailures = new Set([400, 403, 404, 413]);

// RelayConnection keeps a local document in sync with the relay: it loads the document, sends the
// local updates (batched, retried until they're stored) and applies the remote ones received with
// the websocket events, catching up over HTTP when some are missed.
export default class RelayConnection {
    readonly docId: string;
    readonly clientId: string;
    private api: RelayAPI;
    private handlers: ConnectionHandlers;
    private batchDelay: number;
    private catchUpDelay: number;
    private maxRetryDelay: number;

    private tracker = new SeqTracker();
    private snapshotSeq = 0;
    private queue: Uint8Array[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private catchUpTimer: ReturnType<typeof setTimeout> | null = null;
    private sending = false;
    private retryDelay = 0;
    private loaded = false;
    private stopped = false;
    private catchingUp: Promise<void> | null = null;
    private compacting = false;
    private status: SyncStatus = 'loading';

    constructor(api: RelayAPI, docId: string, clientId: string, handlers: ConnectionHandlers, options: ConnectionOptions = {}) {
        this.api = api;
        this.docId = docId;
        this.clientId = clientId;
        this.handlers = handlers;
        this.batchDelay = options.batchDelay ?? 50;
        this.catchUpDelay = options.catchUpDelay ?? 500;
        this.maxRetryDelay = options.maxRetryDelay ?? 10000;
    }

    get lastSeq() {
        return this.tracker.lastSeq;
    }

    // start loads the document.
    async start() {
        await this.load();
    }

    stop() {
        this.stopped = true;
        this.clearTimers();
    }

    // pending returns whether local updates aren't stored yet.
    pending() {
        return this.queue.length > 0 || this.sending;
    }

    private setStatus(status: SyncStatus, error?: Error) {
        if (this.status !== status) {
            this.status = status;
            this.handlers.onStatus?.(status, error);
        }
    }

    private clearTimers() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.catchUpTimer) {
            clearTimeout(this.catchUpTimer);
            this.catchUpTimer = null;
        }
    }

    private async load() {
        const state = await this.api.getState(this.docId);
        if (this.stopped) {
            return;
        }
        if (state.snapshot) {
            this.handlers.applyRemote(state.snapshot);
        }
        for (const update of state.updates) {
            this.handlers.applyRemote(update.data);
        }
        this.snapshotSeq = state.snapshotSeq;
        this.tracker.reset(state.lastSeq);
        this.loaded = true;
        this.setStatus(this.pending() ? 'saving' : 'saved');
    }

    // send queues a local update.
    send(update: Uint8Array) {
        if (this.stopped) {
            return;
        }
        this.queue.push(update);
        this.setStatus(this.status === 'offline' ? 'offline' : 'saving');
        this.scheduleFlush(this.batchDelay);
    }

    private scheduleFlush(delay: number) {
        if (this.flushTimer || this.stopped) {
            return;
        }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flush();
        }, delay);
    }

    // flush sends the queued updates now.
    async flush() {
        if (this.sending || !this.queue.length || this.stopped) {
            return;
        }

        const updates = this.queue;
        this.queue = [];
        const data = updates.length === 1 ? updates[0] : this.handlers.merge(updates);
        this.sending = true;
        let result: AppendResult | null = null;
        try {
            result = await this.api.postUpdate(this.docId, this.clientId, data);
        } catch (err) {
            this.sending = false;
            if (err instanceof RelayError && permanentFailures.has(err.status)) {
                if (err.status === 403) {
                    this.handlers.onReadOnly?.();
                }
                this.setStatus('error', err);
                if (this.queue.length) {
                    this.scheduleFlush(this.batchDelay);
                }
                return;
            }

            // Keep the update, in order, and retry later
            this.queue.unshift(data);
            this.retryDelay = Math.min(this.maxRetryDelay, this.retryDelay ? this.retryDelay * 2 : 1000);
            this.setStatus('offline', err as Error);
            this.scheduleFlush(this.retryDelay);
            return;
        }

        this.sending = false;
        this.retryDelay = 0;
        if (this.stopped) {
            return;
        }
        this.tracker.mark(result.seq);
        this.checkGap();
        if (this.queue.length) {
            this.scheduleFlush(this.batchDelay);
        } else {
            this.setStatus('saved');
        }
        if (result.compact) {
            this.compact();
        }
    }

    // compact posts a snapshot of the document, covering every update the client has in order.
    async compact() {
        const snapshot = this.handlers.snapshot;
        if (!snapshot || this.compacting || this.stopped || !this.loaded) {
            return;
        }
        const seq = this.tracker.lastSeq;
        if (seq <= this.snapshotSeq) {
            return;
        }

        this.compacting = true;
        try {
            await this.api.putSnapshot(this.docId, seq, snapshot());
            this.snapshotSeq = seq;
        } catch (err) {
            // Another client compacted first, or this one will compact with a later update
            if (err instanceof RelayError && err.status === 409) {
                this.snapshotSeq = Math.max(this.snapshotSeq, seq);
            }
        } finally {
            this.compacting = false;
        }
    }

    // handleUpdate handles the websocket event of an update.
    handleUpdate(event: UpdateEvent) {
        if (this.stopped || event.doc_id !== this.docId) {
            return;
        }
        if (event.client_id === this.clientId) {
            this.tracker.mark(event.seq);
        } else if (!this.tracker.has(event.seq)) {
            if (typeof event.data !== 'string' || !this.loaded) {
                // Too large to be sent in the event, or arrived while loading: fetch it
                this.scheduleCatchUp(0);
                return;
            }
            this.handlers.applyRemote(fromBase64(event.data));
            this.tracker.mark(event.seq);
        }
        this.checkGap();
    }

    handleAwareness(event: AwarenessEvent) {
        if (this.stopped || event.doc_id !== this.docId || event.client_id === this.clientId) {
            return;
        }
        this.handlers.applyAwareness?.(event.client_id, fromBase64(event.data));
    }

    // sendAwareness sends the presence of the local user to the other clients. Callers throttle it.
    sendAwareness(data: Uint8Array, keepalive = false) {
        if (this.stopped && !keepalive) {
            return;
        }
        this.api.postAwareness(this.docId, this.clientId, data, keepalive).catch(() => {
            // Presence is best effort
        });
    }

    private checkGap() {
        if (this.tracker.hasGap()) {
            this.scheduleCatchUp(this.catchUpDelay);
        }
    }

    private scheduleCatchUp(delay: number) {
        if (this.catchUpTimer || this.stopped) {
            return;
        }
        this.catchUpTimer = setTimeout(() => {
            this.catchUpTimer = null;
            this.catchUp();
        }, delay);
    }

    // catchUp fetches the updates the client missed, e.g. after the websocket reconnected.
    catchUp(): Promise<void> {
        if (!this.catchingUp) {
            this.catchingUp = this.doCatchUp().finally(() => {
                this.catchingUp = null;
            });
        }
        return this.catchingUp;
    }

    // reload loads the whole document again, e.g. after a version was restored.
    reload(): Promise<void> {
        return this.load();
    }

    private async doCatchUp() {
        if (this.stopped) {
            return;
        }
        try {
            if (!this.loaded) {
                await this.load();
                return;
            }
            const {updates, reset} = await this.api.getUpdates(this.docId, this.tracker.lastSeq);
            if (this.stopped) {
                return;
            }
            if (reset) {
                await this.load();
                return;
            }
            for (const update of updates) {
                if (!this.tracker.has(update.seq)) {
                    this.handlers.applyRemote(update.data);
                    this.tracker.mark(update.seq);
                }
            }
            if (this.status === 'offline' && !this.pending()) {
                this.setStatus('saved');
            }
        } catch (err) {
            this.setStatus('offline', err as Error);
            this.scheduleCatchUp(this.maxRetryDelay);
        }
    }
}
