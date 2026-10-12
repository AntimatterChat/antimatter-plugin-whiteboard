// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {useEffect, useState, useSyncExternalStore} from 'react';

import {client} from '../client';
import {librariesVersion, loadSharedLibraries, subscribeLibraries, type Libraries, type LibraryItem} from '../libraries';

export type SharedLibraries = {
    libraries: Libraries | null;
    items: LibraryItem[];
};

const NONE: SharedLibraries = {libraries: null, items: []};

// useSharedLibraries loads the libraries of a board's community (its channel's team, or the team
// given for the boards without one) and their items, again when they change. Nothing loads until
// enabled (the board is known).
export function useSharedLibraries(enabled: boolean, channelId: string | undefined, teamId: string | undefined): SharedLibraries {
    const [state, setState] = useState<SharedLibraries>(NONE);
    const version = useSyncExternalStore(subscribeLibraries, librariesVersion);

    useEffect(() => {
        if (!enabled) {
            return () => null;
        }
        let cancelled = false;
        loadSharedLibraries(client, {channelId, teamId}).then(
            (loaded) => !cancelled && setState(loaded),
            () => !cancelled && setState(NONE),
        );
        return () => {
            cancelled = true;
        };
    }, [enabled, channelId, teamId, version]);

    return state;
}
