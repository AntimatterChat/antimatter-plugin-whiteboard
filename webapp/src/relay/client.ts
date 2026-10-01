// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {Client4} from 'mattermost-redux/client';

import {fromBase64, toBase64} from './base64';

// The REST API of the document relay of a plugin (server/relay), under
// /plugins/<plugin id>/api/v1/docs.

export type Doc = {
    id: string;
    title: string;
    channel_id?: string;
    owner_id?: string;
    creator_id: string;
    create_at: number;
    update_at: number;
    updated_by?: string;
    can_edit: boolean;
    can_delete: boolean;
};

export type DocState = {
    snapshot: Uint8Array | null;
    snapshotSeq: number;
    updates: Update[];
    lastSeq: number;
};

export type Update = {
    seq: number;
    data: Uint8Array;
};

export type Version = {
    seq: number;
    at: number;
};

export type AppendResult = {
    seq: number;
    compact: boolean;
};

export class RelayError extends Error {
    status: number;

    // retryAfter is how long to wait before trying again, in milliseconds, when the server says
    // (429 Too Many Requests)
    retryAfter: number;

    constructor(message: string, status: number, retryAfter = 0) {
        super(message);
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

function retryAfterHeader(response: Response): number {
    const seconds = Number(response.headers.get('Retry-After'));
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

type RawUpdate = {seq: number; data: string};

function decodeUpdates(updates: RawUpdate[] | null | undefined): Update[] {
    return (updates || []).map((u) => ({seq: u.seq, data: fromBase64(u.data)}));
}

export class RelayClient {
    private pluginId: string;

    constructor(pluginId: string) {
        this.pluginId = pluginId;
    }

    url(path: string) {
        return `${window.basename || ''}/plugins/${this.pluginId}/api/v1${path}`;
    }

    async request<T>(method: string, path: string, body?: unknown, keepalive = false): Promise<T> {
        const options: RequestInit = {method, keepalive};
        if (typeof body !== 'undefined') {
            options.body = JSON.stringify(body);
        }
        const response = await fetch(this.url(path), Client4.getOptions(options as {method: string}));

        if (!response.ok) {
            let message = response.statusText;
            try {
                const data = await response.json();
                message = data.error || message;
            } catch {
                // Not JSON
            }
            throw new RelayError(message, response.status, retryAfterHeader(response));
        }
        return response.json();
    }

    listDocs(channelId?: string) {
        return this.request<Doc[]>('GET', channelId ? `/docs?channel_id=${encodeURIComponent(channelId)}` : '/docs');
    }

    createDoc(title: string, channelId?: string, content?: Uint8Array) {
        return this.request<Doc>('POST', '/docs', {
            title,
            channel_id: channelId || '',
            ...(content ? {content: toBase64(content)} : {}),
        });
    }

    getDoc(docId: string) {
        return this.request<Doc>('GET', `/docs/${docId}`);
    }

    renameDoc(docId: string, title: string) {
        return this.request<Doc>('PATCH', `/docs/${docId}`, {title});
    }

    deleteDoc(docId: string) {
        return this.request<unknown>('DELETE', `/docs/${docId}`);
    }

    async getState(docId: string): Promise<DocState> {
        const raw = await this.request<{snapshot: string | null; snapshot_seq: number; updates: RawUpdate[]; last_seq: number}>('GET', `/docs/${docId}/state`);
        return {
            snapshot: raw.snapshot ? fromBase64(raw.snapshot) : null,
            snapshotSeq: raw.snapshot_seq,
            updates: decodeUpdates(raw.updates),
            lastSeq: raw.last_seq,
        };
    }

    async getUpdates(docId: string, after: number): Promise<{updates: Update[]; reset: boolean}> {
        const raw = await this.request<{updates: RawUpdate[]; reset: boolean}>('GET', `/docs/${docId}/updates?after=${after}`);
        return {updates: decodeUpdates(raw.updates), reset: raw.reset};
    }

    postUpdate(docId: string, clientId: string, data: Uint8Array) {
        return this.request<AppendResult>('POST', `/docs/${docId}/updates`, {client_id: clientId, data: toBase64(data)});
    }

    putSnapshot(docId: string, seq: number, data: Uint8Array) {
        return this.request<unknown>('PUT', `/docs/${docId}/snapshot`, {seq, data: toBase64(data)});
    }

    postAwareness(docId: string, clientId: string, data: Uint8Array, keepalive = false) {
        return this.request<unknown>('POST', `/docs/${docId}/awareness`, {client_id: clientId, data: toBase64(data)}, keepalive);
    }

    getVersions(docId: string) {
        return this.request<Version[]>('GET', `/docs/${docId}/versions`);
    }

    async getVersion(docId: string, seq: number): Promise<Uint8Array> {
        const raw = await this.request<{data: string}>('GET', `/docs/${docId}/versions/${seq}`);
        return fromBase64(raw.data);
    }
}
