// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {RelayEventBus, type DocListener} from './events';

function listener(docId: string): DocListener & {[k: string]: jest.Mock} {
    return {
        docId,
        handleUpdate: jest.fn(),
        handleAwareness: jest.fn(),
        reload: jest.fn(),
        catchUp: jest.fn(),
    } as unknown as DocListener & {[k: string]: jest.Mock};
}

describe('RelayEventBus', () => {
    test('routes the events to the listeners of the document', () => {
        const bus = new RelayEventBus();
        const a = listener('a');
        const b = listener('b');
        const removeA = bus.addDoc(a);
        bus.addDoc(b);

        bus.handle('update', {doc_id: 'a', client_id: 'c', seq: 1, data: ''});
        bus.handle('awareness', {doc_id: 'b', client_id: 'c', data: ''});
        bus.handle('doc_reset', {doc_id: 'a'});
        expect(a.handleUpdate).toHaveBeenCalledTimes(1);
        expect(a.reload).toHaveBeenCalledTimes(1);
        expect(b.handleUpdate).not.toHaveBeenCalled();
        expect(b.handleAwareness).toHaveBeenCalledTimes(1);

        bus.reconnected();
        expect(a.catchUp).toHaveBeenCalledTimes(1);
        expect(b.catchUp).toHaveBeenCalledTimes(1);

        removeA();
        bus.handle('update', {doc_id: 'a', client_id: 'c', seq: 2, data: ''});
        expect(a.handleUpdate).toHaveBeenCalledTimes(1);
    });

    test('tells the lists about created, renamed and deleted documents', () => {
        const bus = new RelayEventBus();
        const changes: unknown[] = [];
        const record = (change: unknown) => changes.push(change);
        bus.addListListener(record);
        bus.handle('doc_created', {doc_id: 'a', doc: JSON.stringify({id: 'a', title: 'A'})});
        bus.handle('doc_deleted', {doc_id: 'a', doc: JSON.stringify({id: 'a', title: 'A'})});
        bus.handle('doc_updated', {doc_id: 'a', doc: 'not json'});
        expect(changes).toEqual([
            {event: 'created', doc: {id: 'a', title: 'A'}},
            {event: 'deleted', doc: {id: 'a', title: 'A'}},
        ]);
    });
});
