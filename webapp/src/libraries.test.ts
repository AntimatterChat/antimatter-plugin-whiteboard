// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {
    clearLibraryCache,
    formatSize,
    isSharedItem,
    loadPersonalItems,
    loadSharedLibraries,
    PERSONAL_LIBRARY_KEY,
    savePersonalItems,
    withSharedItems,
    type LibrariesAPI,
    type LibraryItem,
} from './libraries';

const LIB = 'abcdefghijklmnopqrstuvwxyz';
const item = (id: string, status: LibraryItem['status'] = 'unpublished'): LibraryItem => ({id, status, elements: [{id: 'e', type: 'rectangle'}], created: 1});

function fakeAPI(libraries: Array<{id: string; team_id: string}>, items: Record<string, LibraryItem[] | Error>) {
    const api = {
        listLibraries: jest.fn().mockResolvedValue({
            team_id: 't',
            can_manage_team: false,
            can_manage_server: false,
            libraries: libraries.map((l) => ({...l, name: l.id, item_count: 1, size: 1, creator_id: 'u', create_at: 1, update_at: 1})),
        }),
        getLibraryItems: jest.fn((id: string) => {
            const result = items[id];
            return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
        }),
    };
    return api as typeof api & LibrariesAPI;
}

beforeEach(() => {
    localStorage.clear();
    clearLibraryCache();
});

test('the items of the shared libraries are told apart by their ids', () => {
    expect(isSharedItem({id: `lib-${LIB}-0`})).toBe(true);
    expect(isSharedItem({id: `lib-${LIB}-12`})).toBe(true);
    expect(isSharedItem({id: 'lib-short-1'})).toBe(false);
    expect(isSharedItem({id: 'Xa8c9k2j3h4g5f6d7s8a9'})).toBe(false);
});

test('only the user\'s own items are kept in the browser', () => {
    savePersonalItems([item('mine'), item(`lib-${LIB}-0`, 'published')]);
    expect(JSON.parse(localStorage.getItem(PERSONAL_LIBRARY_KEY) || '')).toEqual([item('mine')]);
    expect(loadPersonalItems()).toEqual([item('mine')]);

    // Shared items saved by an older version, or junk, are dropped
    localStorage.setItem(PERSONAL_LIBRARY_KEY, JSON.stringify([item(`lib-${LIB}-1`), null, {nope: 1}, item('other')]));
    expect(loadPersonalItems().map((i) => i.id)).toEqual(['other']);
    localStorage.setItem(PERSONAL_LIBRARY_KEY, '{broken');
    expect(loadPersonalItems()).toEqual([]);
});

test('the shared items replace the previous ones, after the user\'s', () => {
    const current = [item(`lib-${LIB}-0`, 'published'), item('mine'), item(`lib-${LIB}-1`, 'published')];
    const shared = [item(`lib-${LIB.replace('a', 'b')}-0`, 'published')];
    expect(withSharedItems(current, shared).map((i) => i.id)).toEqual(['mine', shared[0].id]);
});

test('shared libraries load once, without the ones that fail', async () => {
    const other = LIB.replace('z', 'y');
    const api = fakeAPI([{id: LIB, team_id: ''}, {id: other, team_id: 't'}], {
        [LIB]: [{...item(`lib-${LIB}-0`), status: 'unpublished'}],
        [other]: new Error('gone'),
    });

    const loaded = await loadSharedLibraries(api, {channelId: 'c'});
    expect(api.listLibraries).toHaveBeenCalledWith({channelId: 'c'});
    expect(loaded.items.map((i) => [i.id, i.status])).toEqual([[`lib-${LIB}-0`, 'published']]);
    expect(loaded.libraries.team_id).toBe('t');

    // The items never change: loaded once; a failed library is tried again
    await loadSharedLibraries(api, {channelId: 'c'});
    expect(api.getLibraryItems.mock.calls.filter(([id]) => id === LIB)).toHaveLength(1);
    expect(api.getLibraryItems.mock.calls.filter(([id]) => id === other)).toHaveLength(2);
});

test('sizes are readable', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(20 * 1024)).toBe('20 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
});
