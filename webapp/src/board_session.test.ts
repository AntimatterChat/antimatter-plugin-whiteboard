// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import BoardSession, {type BoardFile, type Canvas, type CanvasTools, type Collaborator} from './board_session';
import FakeRelay from './relay/fake_relay';
import {wins, type SceneElement} from './scene';

class FakeBoardAPI extends FakeRelay {
    files = new Map<string, BoardFile>();
    thumbnails = 0;

    async getFile(docId: string, fileId: string) {
        const file = this.files.get(fileId);
        if (!file) {
            throw new Error('not found');
        }
        return file;
    }

    async putFile(docId: string, file: BoardFile) {
        this.files.set(file.id, file);
        return {};
    }

    async putThumbnail() {
        this.thumbnails++;
        return {};
    }
}

// FakeCanvas is an Excalidraw canvas that calls onChange like Excalidraw does.
class FakeCanvas implements Canvas {
    elements: SceneElement[] = [];
    files: Record<string, BoardFile> = {};
    collaborators = new Map<string, Collaborator>();
    onChange: (elements: SceneElement[], files: Record<string, BoardFile>) => void = () => null;

    getSceneElementsIncludingDeleted() {
        return this.elements;
    }
    getAppState() {
        return {};
    }
    getFiles() {
        return this.files;
    }
    updateScene(scene: {elements?: readonly SceneElement[]; collaborators?: Map<string, Collaborator>}) {
        if (scene.collaborators) {
            this.collaborators = scene.collaborators;
        }
        if (scene.elements) {
            this.elements = [...scene.elements];
            this.onChange(this.elements, this.files);
        }
    }
    addFiles(files: BoardFile[]) {
        for (const file of files) {
            this.files[file.id] = file;
        }
    }
    scrollToContent() {
        // Nothing to scroll
    }

    // draw changes elements locally, as a user would.
    draw(...elements: SceneElement[]) {
        const byId = new Map(this.elements.map((e) => [e.id, e]));
        elements.forEach((e) => byId.set(e.id, e));
        this.elements = [...byId.values()];
        this.onChange(this.elements, this.files);
    }
}

function reconcile(local: readonly SceneElement[], remote: readonly SceneElement[]) {
    const byId = new Map(local.map((e) => [e.id, e]));
    for (const element of remote) {
        const current = byId.get(element.id);
        if (!current || wins(element, current)) {
            byId.set(element.id, element);
        }
    }
    return [...byId.values()];
}

const tools: CanvasTools = {reconcile, captureNever: 'never', thumbnail: async () => new Blob(['png'])};
const el = (id: string, version: number, extra: Partial<SceneElement> = {}): SceneElement => ({id, version, versionNonce: version, ...extra});
const summary = (canvas: FakeCanvas) => canvas.elements.map((e) => `${e.id}:${e.version}`).sort();
const names = (session: BoardSession) => session.others().map((c) => c.username).sort();

async function open(relay: FakeBoardAPI, name: string) {
    const session = new BoardSession(relay, 'doc', {userId: name, name, color: '#f00'});
    relay.connect(session.connection);
    await session.start();
    const canvas = new FakeCanvas();
    canvas.onChange = (elements, files) => session.handleChange(elements, files);
    session.attach(canvas, tools);
    return {session, canvas};
}

async function settle() {
    for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(200);
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

describe('BoardSession', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    test('two people draw on the same board', async () => {
        const relay = new FakeBoardAPI();
        const alice = await open(relay, 'alice');
        const bob = await open(relay, 'bob');

        alice.canvas.draw(el('rect', 1));
        await settle();
        expect(summary(bob.canvas)).toEqual(['rect:1']);

        // Concurrent changes of the same element: the higher version wins everywhere
        alice.canvas.draw(el('rect', 3));
        bob.canvas.draw(el('rect', 2), el('ellipse', 1));
        await settle();
        expect(summary(alice.canvas)).toEqual(['ellipse:1', 'rect:3']);
        expect(summary(bob.canvas)).toEqual(['ellipse:1', 'rect:3']);

        // Only the changes are sent
        const posts = relay.posts;
        bob.canvas.draw(el('ellipse', 2));
        await settle();
        expect(relay.posts).toBe(posts + 1);
        expect(relay.updates[relay.updates.length - 1].data.length).toBeLessThan(100);
    });

    test('loads the board before the canvas is there', async () => {
        const relay = new FakeBoardAPI();
        const alice = await open(relay, 'alice');
        alice.canvas.draw(el('a', 1), el('b', 1));
        await settle();

        const session = new BoardSession(relay, 'doc', {userId: 'bob', name: 'bob', color: '#00f'});
        relay.connect(session.connection);
        await session.start();
        const canvas = new FakeCanvas();
        canvas.onChange = (elements, files) => session.handleChange(elements, files);
        const posts = relay.posts;
        session.attach(canvas, tools);
        await settle();
        expect(summary(canvas)).toEqual(['a:1', 'b:1']);

        // Loading doesn't send anything back
        expect(relay.posts).toBe(posts);
    });

    test('shares the images', async () => {
        const relay = new FakeBoardAPI();
        const alice = await open(relay, 'alice');
        const bob = await open(relay, 'bob');

        const file = {id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==', created: 1};
        alice.canvas.files.f1 = file;
        alice.canvas.draw(el('img', 1, {type: 'image', fileId: 'f1'}));
        await settle();
        expect(relay.files.get('f1')).toEqual(file);
        expect(bob.canvas.files.f1).toEqual(file);
    });

    test('shows the pointers of the others', async () => {
        const relay = new FakeBoardAPI();
        const alice = await open(relay, 'alice');
        const bob = await open(relay, 'bob');
        await settle();
        expect(names(alice.session)).toEqual(['bob']);
        expect(names(bob.session)).toEqual(['alice']);

        alice.session.handlePointer({x: 10.4, y: 20.6, tool: 'pointer'}, 'down', {rect: true});
        await settle();
        const pointer = [...bob.canvas.collaborators.values()][0];
        expect(pointer.pointer).toEqual({x: 10, y: 21, tool: 'pointer'});
        expect(pointer.selectedElementIds).toEqual({rect: true});

        alice.session.destroy();
        await settle();
        expect(names(bob.session)).toEqual([]);
    });

    test('saves a thumbnail once the drawing stops', async () => {
        const relay = new FakeBoardAPI();
        const alice = await open(relay, 'alice');
        alice.canvas.draw(el('a', 1));
        await settle();
        expect(relay.thumbnails).toBe(0);
        jest.advanceTimersByTime(5000);
        await settle();
        expect(relay.thumbnails).toBe(1);
    });
});
