// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

// The content of a board: Excalidraw elements, sent to the relay as scenes ({"elements": [...]}).
// The server merges scenes the same way (server/scene.go).

// The part of an Excalidraw element the sync reads.
export type SceneElement = {
    id: string;
    version: number;
    versionNonce: number;
    index?: string | null;
    isDeleted?: boolean;
    type?: string;
    fileId?: string | null;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeScene(elements: readonly SceneElement[]): Uint8Array {
    return encoder.encode(JSON.stringify({elements}));
}

export function decodeScene<T extends SceneElement = SceneElement>(data: Uint8Array): T[] {
    try {
        const scene = JSON.parse(decoder.decode(data));
        return Array.isArray(scene?.elements) ? scene.elements : [];
    } catch {
        return [];
    }
}

// wins returns whether the incoming element replaces the current one: the higher version, then
// the lower version nonce, as Excalidraw reconciles elements.
export function wins(incoming: SceneElement, current: SceneElement): boolean {
    if (incoming.version !== current.version) {
        return incoming.version > current.version;
    }
    return incoming.versionNonce < current.versionNonce;
}

// mergeScenes merges scenes into one with the latest version of each element, e.g. local updates
// waiting to be sent.
export function mergeScenes(scenes: Uint8Array[]): Uint8Array {
    const byId = new Map<string, SceneElement>();
    for (const scene of scenes) {
        for (const element of decodeScene(scene)) {
            const current = byId.get(element.id);
            if (!current || wins(element, current)) {
                byId.set(element.id, element);
            }
        }
    }
    return encodeScene([...byId.values()]);
}

// SyncedVersions remembers the version of each element the relay has (sent or received), to send
// only the elements changed locally.
export class SyncedVersions {
    private versions = new Map<string, string>();

    private static key(element: SceneElement) {
        return `${element.version}:${element.versionNonce}`;
    }

    // record notes that the relay has these versions of the elements.
    record(elements: readonly SceneElement[]) {
        for (const element of elements) {
            this.versions.set(element.id, SyncedVersions.key(element));
        }
    }

    // changed returns the elements whose version the relay doesn't have.
    changed<T extends SceneElement>(elements: readonly T[]): T[] {
        return elements.filter((element) => this.versions.get(element.id) !== SyncedVersions.key(element));
    }
}

// imageFileIds returns the files of the image elements of a scene.
export function imageFileIds(elements: readonly SceneElement[]): string[] {
    const ids = new Set<string>();
    for (const element of elements) {
        if (element.type === 'image' && element.fileId && !element.isDeleted) {
            ids.add(element.fileId);
        }
    }
    return [...ids];
}

// replacementScene returns the elements to replace a board's content by imported elements: the
// current elements deleted, and the imported ones with versions above any the board has seen.
export function replacementScene<T extends SceneElement>(current: readonly T[], imported: readonly T[], nonce: () => number): T[] {
    const versions = new Map(current.map((e) => [e.id, e.version]));
    const importedIds = new Set(imported.map((e) => e.id));
    const now = Date.now();

    const deleted = current.
        filter((e) => !e.isDeleted && !importedIds.has(e.id)).
        map((e) => ({...e, isDeleted: true, version: e.version + 1, versionNonce: nonce(), updated: now}));
    const added = imported.map((e) => ({
        ...e,
        isDeleted: false,
        version: Math.max(e.version, versions.get(e.id) ?? 0) + 1,
        versionNonce: nonce(),
        updated: now,
    }));
    return [...deleted, ...added];
}
