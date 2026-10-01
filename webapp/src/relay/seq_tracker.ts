// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

// SeqTracker follows which updates of a document's log a client has: every update up to lastSeq,
// and some after it, received out of order. A gap means updates were missed (e.g. a dropped
// websocket event) or are still on their way (e.g. the response to the client's own update).
export default class SeqTracker {
    lastSeq: number;
    private ahead = new Set<number>();

    constructor(lastSeq = 0) {
        this.lastSeq = lastSeq;
    }

    // reset starts again from the state of a freshly loaded document.
    reset(lastSeq: number) {
        this.lastSeq = lastSeq;
        for (const seq of this.ahead) {
            if (seq <= lastSeq) {
                this.ahead.delete(seq);
            }
        }
        this.advance();
    }

    // has returns whether the client has the update.
    has(seq: number): boolean {
        return seq <= this.lastSeq || this.ahead.has(seq);
    }

    // mark records that the client has the update.
    mark(seq: number) {
        if (seq <= this.lastSeq) {
            return;
        }
        this.ahead.add(seq);
        this.advance();
    }

    // hasGap returns whether updates before the latest one are missing.
    hasGap(): boolean {
        return this.ahead.size > 0;
    }

    private advance() {
        while (this.ahead.has(this.lastSeq + 1)) {
            this.ahead.delete(this.lastSeq + 1);
            this.lastSeq++;
        }
    }
}
