// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import RelayConnection, {type RelayAPI, type SyncStatus} from './relay/connection';
import {decodeScene, encodeScene, imageFileIds, mergeScenes, SyncedVersions, wins, type SceneElement} from './scene';

// An image of a board, as Excalidraw keeps them (BinaryFileData).
export type BoardFile = {
    id: string;
    mimeType: string;
    dataURL: string;
    created: number;
};

// The part of the board API used besides the relay.
export interface BoardAPI extends RelayAPI {
    getFile(docId: string, fileId: string): Promise<BoardFile>;
    putFile(docId: string, file: BoardFile): Promise<unknown>;
    putThumbnail(docId: string, png: Blob): Promise<unknown>;
}

export type BoardUser = {
    userId: string;
    name: string;
    color: string;
    avatarUrl?: string;
};

export type Pointer = {x: number; y: number; tool: 'pointer' | 'laser'};

// A collaborator, as Excalidraw draws them.
export type Collaborator = {
    id: string;
    socketId: string;
    username: string;
    avatarUrl?: string;
    color: {background: string; stroke: string};
    pointer?: Pointer;
    button?: 'up' | 'down';
    selectedElementIds?: Record<string, true>;
};

// The part of Excalidraw's imperative API the session uses.
export interface Canvas {
    getSceneElementsIncludingDeleted(): readonly SceneElement[];
    getAppState(): unknown;
    getFiles(): Record<string, BoardFile>;
    updateScene(scene: {elements?: readonly SceneElement[]; collaborators?: Map<string, Collaborator>; captureUpdate?: unknown}): void;
    addFiles(files: BoardFile[]): void;
    scrollToContent(): void;
}

// The functions of the Excalidraw module the session uses (loaded with it).
export type CanvasTools = {
    reconcile(local: readonly SceneElement[], remote: readonly SceneElement[], appState: unknown): SceneElement[];
    captureNever: unknown;
    thumbnail(elements: readonly SceneElement[], files: Record<string, BoardFile>, appState: unknown): Promise<Blob | null>;
};

type Presence = {
    userId: string;
    name: string;
    color: string;
    avatarUrl?: string;
    pointer?: Pointer;
    button?: 'up' | 'down';
    selected?: string[];
    left?: boolean;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// How often the pointer is sent, how often presence is sent while idle, and when the
// collaborators who stopped sending are dropped.
const POINTER_INTERVAL = 60;
const HEARTBEAT_INTERVAL = 15000;
const COLLABORATOR_TIMEOUT = 45000;

// The thumbnail is made after this long without changes, at most this often.
const THUMBNAIL_IDLE = 5000;
const THUMBNAIL_INTERVAL = 30000;

// BoardSession is an open board, kept in sync with the relay: the elements of its Excalidraw
// canvas, its images, and the pointers and selections of the people who have it open.
export default class BoardSession {
    readonly connection: RelayConnection;
    readonly clientId = Math.random().toString(36).slice(2, 12);
    status: SyncStatus = 'loading';
    readOnly = false;
    version = 0;

    // The board's elements, also before the canvas is there (and between canvases).
    elements: SceneElement[] = [];

    private api: BoardAPI;
    private user: BoardUser;
    private canvas: Canvas | null = null;
    private tools: CanvasTools | null = null;
    private synced = new SyncedVersions();
    private remoteBeforeCanvas = new Map<string, SceneElement>();
    private knownFiles = new Set<string>();
    private requestedFiles = new Set<string>();
    private collaborators = new Map<string, Collaborator & {seen: number}>();
    private listeners = new Set<() => void>();
    private presence: Presence;
    private pointerTimer: ReturnType<typeof setTimeout> | null = null;
    private heartbeat: ReturnType<typeof setInterval> | null = null;
    private thumbnailTimer: ReturnType<typeof setTimeout> | null = null;
    private lastThumbnail = 0;
    private scrolled = false;
    private destroyed = false;

    constructor(api: BoardAPI, docId: string, user: BoardUser) {
        this.api = api;
        this.user = user;
        this.presence = {userId: user.userId, name: user.name, color: user.color, avatarUrl: user.avatarUrl};
        this.connection = new RelayConnection(api, docId, this.clientId, {
            applyRemote: (data) => this.applyRemote(decodeScene(data)),
            merge: mergeScenes,
            applyAwareness: (clientId, data) => this.applyPresence(clientId, data),
            onStatus: (status) => {
                this.status = status;
                this.emit();
            },
            onReadOnly: () => {
                this.readOnly = true;
                this.emit();
            },
        }, {batchDelay: 100});
    }

    get docId() {
        return this.connection.docId;
    }

    async start() {
        await this.connection.start();
        this.sendPresence();
        this.heartbeat = setInterval(() => {
            this.sendPresence();
            this.dropIdleCollaborators();
        }, HEARTBEAT_INTERVAL);
    }

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit() {
        this.version++;
        for (const listener of this.listeners) {
            listener();
        }
    }

    // attach binds the session to the Excalidraw canvas.
    attach(canvas: Canvas, tools: CanvasTools) {
        this.canvas = canvas;
        this.tools = tools;
        const remote = [...this.remoteBeforeCanvas.values()];
        this.remoteBeforeCanvas.clear();
        if (remote.length) {
            this.applyRemote(remote);
        }
        this.fetchMissingFiles(this.elements);
        canvas.updateScene({collaborators: this.collaboratorMap()});
    }

    detach(canvas: Canvas) {
        if (this.canvas === canvas) {
            this.canvas = null;
        }
    }

    private applyRemote(remote: SceneElement[]) {
        if (!remote.length) {
            return;
        }
        this.synced.record(remote);
        if (!this.canvas || !this.tools) {
            // Keep the latest version of each element for the canvas
            for (const element of remote) {
                const current = this.remoteBeforeCanvas.get(element.id);
                if (!current || wins(element, current)) {
                    this.remoteBeforeCanvas.set(element.id, element);
                }
            }
            return;
        }

        const local = this.canvas.getSceneElementsIncludingDeleted();
        const elements = this.tools.reconcile(local, remote, this.canvas.getAppState());
        this.elements = elements;
        this.canvas.updateScene({elements, captureUpdate: this.tools.captureNever});
        this.fetchMissingFiles(remote);
        if (!this.scrolled) {
            this.scrolled = true;
            this.canvas.scrollToContent();
        }
    }

    // handleChange sends the elements changed on the canvas, and the new images.
    handleChange(elements: readonly SceneElement[], files: Record<string, BoardFile>) {
        if (this.destroyed) {
            return;
        }
        this.elements = elements as SceneElement[];
        if (this.readOnly) {
            return;
        }
        const changed = this.synced.changed(elements);
        if (!changed.length) {
            return;
        }
        this.uploadFiles(changed, files);
        this.synced.record(changed);
        this.connection.send(encodeScene(changed));
        this.scheduleThumbnail();
    }

    private uploadFiles(elements: readonly SceneElement[], files: Record<string, BoardFile>) {
        for (const fileId of imageFileIds(elements)) {
            const file = files[fileId];
            if (!file || this.knownFiles.has(fileId)) {
                continue;
            }
            this.knownFiles.add(fileId);
            this.api.putFile(this.docId, file).catch(() => this.knownFiles.delete(fileId));
        }
    }

    private fetchMissingFiles(elements: readonly SceneElement[]) {
        const canvas = this.canvas;
        if (!canvas) {
            return;
        }
        const files = canvas.getFiles();
        for (const fileId of imageFileIds(elements)) {
            if (files[fileId] || this.requestedFiles.has(fileId)) {
                continue;
            }
            this.requestedFiles.add(fileId);
            this.api.getFile(this.docId, fileId).then((file) => {
                this.knownFiles.add(fileId);
                this.canvas?.addFiles([file]);
            }, () => {
                // Not uploaded yet: try again with the next update
                this.requestedFiles.delete(fileId);
            });
        }
    }

    private scheduleThumbnail() {
        if (this.thumbnailTimer) {
            clearTimeout(this.thumbnailTimer);
        }
        const wait = Math.max(THUMBNAIL_IDLE, (this.lastThumbnail + THUMBNAIL_INTERVAL) - Date.now());
        this.thumbnailTimer = setTimeout(() => {
            this.thumbnailTimer = null;
            this.saveThumbnail();
        }, wait);
    }

    // saveThumbnail makes the thumbnail shown in the cards of the board.
    async saveThumbnail() {
        if (!this.canvas || !this.tools || this.readOnly) {
            return;
        }
        this.lastThumbnail = Date.now();
        try {
            const png = await this.tools.thumbnail(this.canvas.getSceneElementsIncludingDeleted(), this.canvas.getFiles(), this.canvas.getAppState());
            if (png) {
                await this.api.putThumbnail(this.docId, png);
            }
        } catch {
            // The thumbnail is best effort
        }
    }

    // handlePointer sends the pointer of the user to the others.
    handlePointer(pointer: Pointer, button: 'up' | 'down', selectedElementIds: Record<string, unknown>) {
        this.presence = {
            ...this.presence,
            pointer: {x: Math.round(pointer.x), y: Math.round(pointer.y), tool: pointer.tool},
            button,
            selected: Object.keys(selectedElementIds).filter((id) => selectedElementIds[id]),
        };
        if (!this.pointerTimer) {
            this.pointerTimer = setTimeout(() => {
                this.pointerTimer = null;
                this.sendPresence();
            }, POINTER_INTERVAL);
        }
    }

    private sendPresence(keepalive = false) {
        this.connection.sendAwareness(encoder.encode(JSON.stringify(this.presence)), keepalive);
    }

    private applyPresence(clientId: string, data: Uint8Array) {
        let presence: Presence;
        try {
            presence = JSON.parse(decoder.decode(data));
        } catch {
            return;
        }
        if (presence.left) {
            this.collaborators.delete(clientId);
        } else {
            if (!this.collaborators.has(clientId)) {
                // Show ourselves to whoever just opened the board
                setTimeout(() => this.sendPresence(), POINTER_INTERVAL * 5);
            }
            const color = String(presence.color || '#888');
            this.collaborators.set(clientId, {
                id: String(presence.userId),
                socketId: clientId,
                username: String(presence.name || ''),
                avatarUrl: presence.avatarUrl,
                color: {background: color, stroke: color},
                pointer: presence.pointer,
                button: presence.button,
                selectedElementIds: Object.fromEntries((presence.selected || []).map((id) => [id, true as const])),
                seen: Date.now(),
            });
        }
        this.canvas?.updateScene({collaborators: this.collaboratorMap()});
        this.emit();
    }

    private dropIdleCollaborators() {
        const now = Date.now();
        let dropped = false;
        for (const [clientId, collaborator] of this.collaborators) {
            if (now - collaborator.seen > COLLABORATOR_TIMEOUT) {
                this.collaborators.delete(clientId);
                dropped = true;
            }
        }
        if (dropped) {
            this.canvas?.updateScene({collaborators: this.collaboratorMap()});
            this.emit();
        }
    }

    private collaboratorMap() {
        const map = new Map<string, Collaborator>();
        for (const [id, collaborator] of this.collaborators) {
            const {seen, ...c} = collaborator; // eslint-disable-line @typescript-eslint/no-unused-vars
            map.set(id, c);
        }
        return map;
    }

    // others returns the other people who have the board open.
    others(): Collaborator[] {
        return [...this.collaborators.values()];
    }

    // destroy leaves the board: the others stop seeing this user, and the pending changes are sent.
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        for (const timer of [this.pointerTimer, this.thumbnailTimer]) {
            if (timer) {
                clearTimeout(timer);
            }
        }
        if (this.heartbeat) {
            clearInterval(this.heartbeat);
        }
        if (this.thumbnailTimer) {
            this.saveThumbnail();
        }
        this.presence = {...this.presence, left: true};
        this.sendPresence(true);
        const connection = this.connection;
        connection.flush().finally(() => connection.stop());
        this.listeners.clear();
    }
}
