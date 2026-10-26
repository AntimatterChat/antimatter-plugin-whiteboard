// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage} from 'react-intl';

import type BoardSession from '../board_session';

import {useSteadyStatus} from './steady_status';

// StatusText is the board's state, at the end of its toolbar: read only, or how its changes are saved, or
// that it's full (the server left out what was drawn past the caps).
export default function StatusText({session, editable}: {session: Pick<BoardSession, 'status' | 'full'>; editable: boolean}) {
    const steady = useSteadyStatus(session.status);
    if (!editable) {
        return (
            <FormattedMessage
                id='whiteboard.status.read_only'
                defaultMessage='Read only'
            />
        );
    }
    if (session.full && steady !== 'offline' && steady !== 'error' && steady !== 'loading') {
        return (
            <FormattedMessage
                id='whiteboard.status.full'
                defaultMessage={"Board full: new drawings aren't saved"}
                description='Status at the end of the toolbar of a board that holds as much as it can (50,000 shapes or 20 MB): what is drawn now is left out when it is saved. Deleting shapes makes room again.'
            />
        );
    }
    switch (steady) {
    case 'loading':
        return (
            <FormattedMessage
                id='whiteboard.status.loading'
                defaultMessage='Loading…'
            />
        );
    case 'saving':
        return (
            <FormattedMessage
                id='whiteboard.status.saving'
                defaultMessage='Saving…'
            />
        );
    case 'offline':
        return (
            <FormattedMessage
                id='whiteboard.status.offline'
                defaultMessage='Offline'
            />
        );
    case 'error':
        return (
            <FormattedMessage
                id='whiteboard.status.error'
                defaultMessage='Not saved'
            />
        );
    default:
        return (
            <FormattedMessage
                id='whiteboard.status.saved'
                defaultMessage='Saved'
            />
        );
    }
}
