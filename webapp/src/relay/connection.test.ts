// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {TextDecoder, TextEncoder} from 'util';

import RelayConnection, {type ConnectionHandlers} from './connection';
import FakeRelay from './fake_relay';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// A document made of the strings it received, in order.
function textClient(relay: FakeRelay, clientId: string, handlers: Partial<ConnectionHandlers> = {}) {
    const received: string[] = [];
    const connection = new RelayConnection(relay, 'doc', clientId, {
        applyRemote: (data) => received.push(decoder.decode(data)),
        merge: (updates) => encoder.encode(updates.map((u) => decoder.decode(u)).join('+')),
        snapshot: () => encoder.encode('snapshot'),
        ...handlers,
    }, {batchDelay: 10, catchUpDelay: 50, maxRetryDelay: 1000});
    relay.connect(connection);
    return {connection, received};
}

async function flushPromises() {
    for (let i = 0; i < 10; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

async function advance(ms: number) {
    jest.advanceTimersByTime(ms);
    await flushPromises();
}

describe('RelayConnection', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    test('loads the snapshot and the updates', async () => {
        const relay = new FakeRelay();
        relay.snapshot = encoder.encode('s');
        relay.snapshotSeq = 2;
        relay.updates = [{seq: 3, data: encoder.encode('u3')}];
        relay.lastSeq = 3;

        const statuses: string[] = [];
        const {connection, received} = textClient(relay, 'a', {onStatus: (s) => statuses.push(s)});
        await connection.start();
        expect(received).toEqual(['s', 'u3']);
        expect(connection.lastSeq).toBe(3);
        expect(statuses).toEqual(['saved']);
    });

    test('batches local updates and relays them to the other clients', async () => {
        const relay = new FakeRelay();
        const a = textClient(relay, 'a');
        const b = textClient(relay, 'b');
        await a.connection.start();
        await b.connection.start();

        a.connection.send(encoder.encode('1'));
        a.connection.send(encoder.encode('2'));
        expect(a.connection.pending()).toBe(true);
        await advance(10);

        expect(relay.posts).toBe(1);
        expect(b.received).toEqual(['1+2']);
        expect(a.received).toEqual([]);
        expect(a.connection.lastSeq).toBe(1);
        expect(b.connection.lastSeq).toBe(1);
        expect(a.connection.pending()).toBe(false);
    });

    test('catches up on missed events', async () => {
        const relay = new FakeRelay();
        const a = textClient(relay, 'a');
        const b = textClient(relay, 'b');
        await a.connection.start();
        await b.connection.start();

        relay.dropEvents = true;
        a.connection.send(encoder.encode('lost'));
        await advance(10);
        relay.dropEvents = false;
        a.connection.send(encoder.encode('next'));
        await advance(10);

        // b got seq 2 but not 1: it fetches the missing update after a while
        expect(b.received).toEqual(['next']);
        await advance(50);
        expect(b.received).toEqual(['next', 'lost']);
        expect(b.connection.lastSeq).toBe(2);
    });

    test('fetches the updates too large for the events', async () => {
        const relay = new FakeRelay();
        const b = textClient(relay, 'b');
        await b.connection.start();
        relay.updates.push({seq: 1, data: encoder.encode('big')});
        relay.lastSeq = 1;

        b.connection.handleUpdate({doc_id: 'doc', client_id: 'a', seq: 1});
        await advance(0);
        expect(b.received).toEqual(['big']);
    });

    test('ignores the events of other documents and its own updates', async () => {
        const relay = new FakeRelay();
        const a = textClient(relay, 'a');
        await a.connection.start();
        a.connection.handleUpdate({doc_id: 'other', client_id: 'b', seq: 1, data: btoa('x')});
        a.connection.handleUpdate({doc_id: 'doc', client_id: 'a', seq: 1, data: btoa('mine')});
        expect(a.received).toEqual([]);
        expect(a.connection.lastSeq).toBe(1);
    });

    test('retries failed updates in order', async () => {
        const relay = new FakeRelay();
        const statuses: string[] = [];
        const a = textClient(relay, 'a', {onStatus: (s) => statuses.push(s)});
        const b = textClient(relay, 'b');
        await a.connection.start();
        await b.connection.start();

        relay.failNext = 2;
        a.connection.send(encoder.encode('1'));
        await advance(10);
        expect(statuses).toContain('offline');
        a.connection.send(encoder.encode('2'));
        await advance(1000); // first retry fails
        expect(b.received).toEqual([]);
        await advance(2000); // second retry: both updates, merged in order
        expect(b.received).toEqual(['1+2']);
        expect(statuses[statuses.length - 1]).toBe('saved');
    });

    test('waits when sending too fast', async () => {
        const relay = new FakeRelay();
        const statuses: string[] = [];
        const a = textClient(relay, 'a', {onStatus: (s) => statuses.push(s)});
        const b = textClient(relay, 'b');
        await a.connection.start();
        await b.connection.start();

        relay.failNext = 1;
        relay.failStatus = 429;
        a.connection.send(encoder.encode('1'));
        await advance(10);
        a.connection.send(encoder.encode('2'));
        await advance(1500);
        expect(b.received).toEqual([]);
        expect(statuses).not.toContain('offline');
        await advance(500); // the server said two seconds
        expect(b.received).toEqual(['1+2']);
        expect(statuses[statuses.length - 1]).toBe('saved');
    });

    test('drops updates refused for good', async () => {
        const relay = new FakeRelay();
        const onReadOnly = jest.fn();
        const a = textClient(relay, 'a', {onReadOnly});
        await a.connection.start();

        relay.failNext = 1;
        relay.failStatus = 403;
        a.connection.send(encoder.encode('1'));
        await advance(10);
        expect(onReadOnly).toHaveBeenCalled();
        expect(a.connection.pending()).toBe(false);
        await advance(5000);
        expect(relay.posts).toBe(1);
    });

    test('compacts when the server asks', async () => {
        const relay = new FakeRelay();
        relay.compactAfter = 2;
        const a = textClient(relay, 'a');
        const b = textClient(relay, 'b');
        await a.connection.start();
        await b.connection.start();

        a.connection.send(encoder.encode('1'));
        await advance(10);
        expect(relay.snapshot).toBeNull();
        a.connection.send(encoder.encode('2'));
        await advance(10);
        expect(decoder.decode(relay.snapshot as Uint8Array)).toBe('snapshot');
        expect(relay.snapshotSeq).toBe(2);
        expect(relay.updates).toEqual([]);

        // A client that missed compacted updates loads the document again
        const c = textClient(relay, 'c');
        await c.connection.start();
        expect(c.received).toEqual(['snapshot']);
        relay.updates.push({seq: 3, data: encoder.encode('3')});
        relay.lastSeq = 3;
        b.connection.handleUpdate({doc_id: 'doc', client_id: 'a', seq: 4, data: btoa('4')});
        relay.snapshotSeq = 3;
        await advance(50);
        expect(b.received).toEqual(['1', '2', '4', 'snapshot', '3']);

        // It already had the 4th update
        expect(b.connection.lastSeq).toBe(4);
    });

    test('relays the presence of the others', async () => {
        const relay = new FakeRelay();
        const seen: string[] = [];
        const a = textClient(relay, 'a', {applyAwareness: (id, data) => seen.push(`a<-${id}:${decoder.decode(data)}`)});
        const b = textClient(relay, 'b', {applyAwareness: (id, data) => seen.push(`b<-${id}:${decoder.decode(data)}`)});
        await a.connection.start();
        await b.connection.start();
        a.connection.sendAwareness(encoder.encode('cursor'));
        await flushPromises();
        expect(seen).toEqual(['b<-a:cursor']);
    });
});
