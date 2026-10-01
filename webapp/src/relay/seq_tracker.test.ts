// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import SeqTracker from './seq_tracker';

describe('SeqTracker', () => {
    test('advances over contiguous updates', () => {
        const tracker = new SeqTracker(2);
        expect(tracker.has(2)).toBe(true);
        expect(tracker.has(3)).toBe(false);

        tracker.mark(3);
        expect(tracker.lastSeq).toBe(3);
        expect(tracker.hasGap()).toBe(false);

        // Old updates change nothing
        tracker.mark(1);
        expect(tracker.lastSeq).toBe(3);
    });

    test('tracks gaps until they are filled', () => {
        const tracker = new SeqTracker();
        tracker.mark(2);
        tracker.mark(4);
        expect(tracker.lastSeq).toBe(0);
        expect(tracker.hasGap()).toBe(true);
        expect(tracker.has(2)).toBe(true);
        expect(tracker.has(3)).toBe(false);

        tracker.mark(1);
        expect(tracker.lastSeq).toBe(2);
        expect(tracker.hasGap()).toBe(true);

        tracker.mark(3);
        expect(tracker.lastSeq).toBe(4);
        expect(tracker.hasGap()).toBe(false);
    });

    test('reset keeps the updates received after the loaded state', () => {
        const tracker = new SeqTracker();
        tracker.mark(5);
        tracker.mark(7);
        tracker.reset(5);
        expect(tracker.lastSeq).toBe(5);
        expect(tracker.has(7)).toBe(true);

        tracker.reset(6);
        expect(tracker.lastSeq).toBe(7);
        expect(tracker.hasGap()).toBe(false);
    });
});
