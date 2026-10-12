// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

// The library of the boards (Excalidraw's library panel) holds the user's own items, kept in the
// browser, and the items of the libraries the admins added: the server's, and those of the
// community (team) of the board.

// Library is a library added by an admin (server/library.go).
export type Library = {
    id: string;
    name: string;

    // Empty for the server's libraries
    team_id: string;
    item_count: number;
    size: number;
    creator_id: string;
    create_at: number;
    update_at: number;
};

export type Libraries = {
    team_id: string;
    can_manage_team: boolean;
    can_manage_server: boolean;
    libraries: Library[];
};

// LibraryItem is an item of Excalidraw's library: a few elements, reused together.
export type LibraryItem = {
    id: string;
    status: 'published' | 'unpublished';
    elements: unknown[];
    created: number;
    name?: string;
};

export type LibrariesAPI = {
    listLibraries(where: {channelId?: string; teamId?: string}): Promise<Libraries>;
    getLibraryItems(libraryId: string): Promise<LibraryItem[]>;
};

export const PERSONAL_LIBRARY_KEY = 'antimatter-whiteboard-library';

// The server names the items of its libraries lib-<library id>-<n> (server/library.go).
const SHARED_ITEM = /^lib-[a-z0-9]{26}-\d+$/;

export function isSharedItem(item: {id: string}): boolean {
    return SHARED_ITEM.test(item.id);
}

// loadPersonalItems returns the user's own items, kept in the browser.
export function loadPersonalItems(): LibraryItem[] {
    try {
        const items = JSON.parse(localStorage.getItem(PERSONAL_LIBRARY_KEY) || '[]');
        return Array.isArray(items) ? items.filter((item) => item && typeof item.id === 'string' && !isSharedItem(item)) : [];
    } catch {
        return [];
    }
}

// savePersonalItems keeps the user's own items of the library, without the shared ones.
export function savePersonalItems(items: ReadonlyArray<{id: string}>) {
    try {
        localStorage.setItem(PERSONAL_LIBRARY_KEY, JSON.stringify(items.filter((item) => !isSharedItem(item))));
    } catch {
        // A full storage loses the library's last change
    }
}

// The items of a library never change: they're loaded once.
const itemsCache = new Map<string, Promise<LibraryItem[]>>();

function libraryItems(api: LibrariesAPI, libraryId: string) {
    let items = itemsCache.get(libraryId);
    if (!items) {
        items = api.getLibraryItems(libraryId).catch((err) => {
            itemsCache.delete(libraryId);
            throw err;
        });
        itemsCache.set(libraryId, items);
    }
    return items;
}

export function clearLibraryCache() {
    itemsCache.clear();
}

// loadSharedLibraries returns the libraries of a board's community, and their items: the server's
// first, then the community's. A library that fails to load is left out.
export async function loadSharedLibraries(api: LibrariesAPI, where: {channelId?: string; teamId?: string}) {
    const libraries = await api.listLibraries(where);
    const loaded = await Promise.all(libraries.libraries.map((library) => libraryItems(api, library.id).catch(() => [] as LibraryItem[])));
    const items = loaded.flat().map((item) => ({...item, status: 'published' as const}));
    return {libraries, items};
}

// withSharedItems returns the library's items with the shared items replaced: the user's own first.
export function withSharedItems<T extends {id: string}>(current: readonly T[], shared: readonly T[]): T[] {
    return [...current.filter((item) => !isSharedItem(item)), ...shared];
}

// formatSize returns a size in bytes for people.
export function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// The libraries changed (one was added, renamed or deleted here): the open boards load them again.
let changes = 0;
const listeners = new Set<() => void>();

export function librariesChanged() {
    changes++;
    listeners.forEach((l) => l());
}

export function subscribeLibraries(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function librariesVersion() {
    return changes;
}
