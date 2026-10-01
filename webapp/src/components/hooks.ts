// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {useEffect} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import type {Dispatch} from 'redux';

import type {GlobalState} from '@mattermost/types/store';
import type {UserProfile} from '@mattermost/types/users';

import {UserTypes} from 'mattermost-redux/action_types';
import {Client4} from 'mattermost-redux/client';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getUser} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

// The users to load, batched in one request. (The mattermost-redux actions would bring most of
// mattermost-redux, and moment, in the bundle.)
const requested = new Set<string>();
let batch: string[] = [];

function loadUser(dispatch: Dispatch, userId: string) {
    if (requested.has(userId)) {
        return;
    }
    requested.add(userId);
    batch.push(userId);
    if (batch.length > 1) {
        return;
    }
    setTimeout(async () => {
        const ids = batch;
        batch = [];
        try {
            const profiles = await Client4.getProfilesByIds(ids);
            dispatch({type: UserTypes.RECEIVED_PROFILES_LIST, data: profiles});
        } catch {
            ids.forEach((id) => requested.delete(id));
        }
    }, 0);
}

// useDisplayName returns the name of a user as the viewer chose to see names, loading the user
// if needed.
export function useDisplayName(userId?: string): string {
    const dispatch = useDispatch();
    const user = useSelector((state: GlobalState) => (userId ? getUser(state, userId) : null)) as UserProfile | null;
    const setting = useSelector(getTeammateNameDisplaySetting);

    useEffect(() => {
        if (userId && !user) {
            loadUser(dispatch, userId);
        }
    }, [dispatch, userId, user]);

    return user ? displayUsername(user, setting) : '';
}
