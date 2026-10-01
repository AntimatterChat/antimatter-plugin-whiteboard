// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {decodeScene, encodeScene, imageFileIds, mergeScenes, replacementScene, SyncedVersions, wins, type SceneElement} from './scene';

const el = (id: string, version: number, versionNonce = 1, extra: Partial<SceneElement> = {}): SceneElement => ({id, version, versionNonce, ...extra});
const ids = (elements: SceneElement[]) => elements.map((e) => `${e.id}:${e.version}`);
const summary = (elements: SceneElement[]) => elements.map((e) => [e.id, e.version, Boolean(e.isDeleted)]);
const nonceAtLeast = (elements: SceneElement[], min: number) => elements.every((e) => e.versionNonce >= min);

describe('scene', () => {
    test('wins like Excalidraw reconciles', () => {
        expect(wins(el('a', 2), el('a', 1))).toBe(true);
        expect(wins(el('a', 1), el('a', 2))).toBe(false);
        expect(wins(el('a', 2, 3), el('a', 2, 5))).toBe(true);
        expect(wins(el('a', 2, 5), el('a', 2, 3))).toBe(false);
    });

    test('encodes and decodes scenes', () => {
        const elements = [el('a', 1, 1, {type: 'rectangle'})];
        expect(decodeScene(encodeScene(elements))).toEqual(elements);
        expect(decodeScene(new TextEncoder().encode('garbage'))).toEqual([]);
    });

    test('merges scenes keeping the latest versions', () => {
        const merged = mergeScenes([
            encodeScene([el('a', 1), el('b', 2)]),
            encodeScene([el('a', 3), el('b', 1)]),
            encodeScene([el('c', 1)]),
        ]);
        expect(ids(decodeScene(merged))).toEqual(['a:3', 'b:2', 'c:1']);
    });

    test('sends only what changed', () => {
        const synced = new SyncedVersions();
        synced.record([el('a', 1), el('b', 1)]);
        expect(ids(synced.changed([el('a', 1), el('b', 2), el('c', 1)]))).toEqual(['b:2', 'c:1']);

        // Same version, another nonce: changed too
        expect(ids(synced.changed([el('a', 1, 7)]))).toEqual(['a:1']);
    });

    test('lists the files of the images', () => {
        expect(imageFileIds([
            el('a', 1, 1, {type: 'image', fileId: 'f1'}),
            el('b', 1, 1, {type: 'image', fileId: 'f1'}),
            el('c', 1, 1, {type: 'image', fileId: 'f2', isDeleted: true}),
            el('d', 1, 1, {type: 'rectangle'}),
        ])).toEqual(['f1']);
    });

    test('replaces a board by imported elements', () => {
        let n = 100;
        const nonce = () => n++;
        const scene = replacementScene(
            [el('old', 4), el('same', 7), el('gone', 2, 1, {isDeleted: true})],
            [el('same', 1), el('new', 1)],
            nonce,
        );
        expect(summary(scene)).toEqual([
            ['old', 5, true],
            ['same', 8, false],
            ['new', 2, false],
        ]);
        expect(nonceAtLeast(scene, 100)).toBe(true);
    });
});
