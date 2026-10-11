// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React from 'react';
import {useIntl} from 'react-intl';
import {useSelector} from 'react-redux';

import {getChannel} from 'mattermost-redux/selectors/entities/channels';

import type {GlobalState} from '@mattermost/types/store';

import type {Doc} from '../relay/client';
import Icon from '../ui/icon';
import {cx} from '../ui/web_ui';

// ScopeChip tells at a glance whose a board is: shared with a channel (its name, in the app's colour), or
// personal (a lock, muted).
export default function ScopeChip({doc}: {doc: Doc}) {
    const intl = useIntl();
    const channel = useSelector((state: GlobalState) => (doc.channel_id ? getChannel(state, doc.channel_id) : null));
    if (!doc.channel_id) {
        return (
            <span
                className={cx('wb-scope', 'wb-scope-personal')}
                title={intl.formatMessage({id: 'whiteboard.scope.personal_tip', defaultMessage: 'Personal: only you can see it'})}
            >
                <Icon
                    name='lock'
                    size='xs'
                />
                {intl.formatMessage({id: 'whiteboard.scope.personal', defaultMessage: 'Personal'})}
            </span>
        );
    }
    const conversation = channel?.type === 'D' || channel?.type === 'G';
    const name = conversation ? intl.formatMessage({id: 'whiteboard.scope.conversation', defaultMessage: 'Conversation'}) : channel?.display_name || '';
    return (
        <span
            className={cx('wb-scope', 'wb-scope-shared')}
            title={conversation ? intl.formatMessage({id: 'whiteboard.scope.conversation_tip', defaultMessage: 'Shared with everyone in this conversation'}) : intl.formatMessage({id: 'whiteboard.scope.shared_tip', defaultMessage: 'Shared with everyone in ~{channel}'}, {channel: name})}
        >
            <Icon
                name={conversation ? 'users' : 'hash'}
                size='xs'
            />
            {name}
        </span>
    );
}
