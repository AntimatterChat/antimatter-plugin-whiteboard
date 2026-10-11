// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {useEffect, useRef, useState} from 'react';

import type {SyncStatus} from '../relay/connection';

// How long saving must last before it shows, and how long it shows at least: saves of a moment don't flash
// "Saving…" and "Saved" by turns.
const SHOW_AFTER = 1000;
const SHOW_AT_LEAST = 700;

// useSteadyStatus is the sync status to show: the status, but saving only once it lasts.
export function useSteadyStatus(status: SyncStatus): SyncStatus {
    const [shown, setShown] = useState<SyncStatus>(status === 'saving' ? 'saved' : status);
    const since = useRef(0);

    useEffect(() => {
        if (status === 'saving') {
            if (shown === 'saving') {
                return () => null;
            }
            const timer = setTimeout(() => {
                since.current = Date.now();
                setShown('saving');
            }, SHOW_AFTER);
            return () => clearTimeout(timer);
        }
        if (shown === 'saving') {
            const timer = setTimeout(() => setShown(status), Math.max(0, (since.current + SHOW_AT_LEAST) - Date.now()));
            return () => clearTimeout(timer);
        }
        setShown(status);
        return () => null;
    }, [status, shown]);

    return shown;
}
