// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';

import type {Channel} from '@mattermost/types/channels';

import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {client, events} from '../client';
import type {Doc} from '../relay/client';
import Icon from '../ui/icon';
import {cx} from '../ui/web_ui';
import {setOpenDoc} from '../ui_state';

import {useDisplayName} from './hooks';
import RelativeTime from './relative_time';

function BoardRow({doc}: {doc: Doc}) {
    const editor = useDisplayName(doc.updated_by || doc.creator_id);
    return (
        <button
            className={cx('app-row')}
            onClick={() => setOpenDoc(doc.id)}
        >
            <span className={cx('wb-row-ic')}><Icon name='draw'/></span>
            <span className={cx('wb-row-main')}>
                <b>{doc.title}</b>
                <span className={cx('sub')}>
                    <FormattedMessage
                        id='whiteboard.list.edited'
                        defaultMessage='Edited {when} by {name}'
                        values={{when: <RelativeTime value={doc.update_at}/>, name: editor || '…'}}
                    />
                </span>
            </span>
            {!doc.can_edit && <span className={cx('sub')}><Icon name='lock'/></span>}
        </button>
    );
}

type SectionProps = {
    title: React.ReactNode;
    docs: Doc[] | null;
    empty: React.ReactNode;
    canCreate: boolean;
    onCreate: () => void;
    createLabel: string;
};

function Section({title, docs, empty, canCreate, onCreate, createLabel}: SectionProps) {
    return (
        <>
            <div className={cx('app-h')}>
                <span className={cx('grow')}>{title}</span>
                {canCreate && (
                    <button
                        className={cx('icon-btn', 'wb-h-btn')}
                        title={createLabel}
                        aria-label={createLabel}
                        onClick={onCreate}
                    >
                        <Icon
                            name='plus'
                            size='sm'
                        />
                    </button>
                )}
            </div>
            {docs?.length ? docs.map((doc) => (
                <BoardRow
                    key={doc.id}
                    doc={doc}
                />
            )) : <div className={cx('wb-empty')}>{docs ? empty : '…'}</div>}
        </>
    );
}

const byUpdate = (a: Doc, b: Doc) => b.update_at - a.update_at;

// BoardList lists the boards of the current channel and the user's personal boards.
export default function BoardList({channel}: {channel?: Channel}) {
    const intl = useIntl();
    const me = useSelector(getCurrentUserId);
    const channelId = channel?.id;
    const [channelDocs, setChannelDocs] = useState<Doc[] | null>(null);
    const [personalDocs, setPersonalDocs] = useState<Doc[] | null>(null);
    const [error, setError] = useState('');

    const loadChannel = useCallback(() => {
        if (!channelId) {
            setChannelDocs([]);
            return;
        }
        client.listDocs(channelId).then((docs) => setChannelDocs(docs.sort(byUpdate)), () => setChannelDocs([]));
    }, [channelId]);
    const loadPersonal = useCallback(() => {
        client.listDocs().then((docs) => setPersonalDocs(docs.sort(byUpdate)), () => setPersonalDocs([]));
    }, []);

    useEffect(() => {
        setChannelDocs(null);
        loadChannel();
    }, [loadChannel]);
    useEffect(loadPersonal, [loadPersonal]);

    useEffect(() => events.addListListener(({doc}) => {
        if (doc.channel_id && doc.channel_id === channelId) {
            loadChannel();
        } else if (!doc.channel_id && doc.owner_id === me) {
            loadPersonal();
        }
    }), [channelId, me, loadChannel, loadPersonal]);

    const create = async (personal: boolean) => {
        setError('');
        try {
            const doc = await client.createDoc('', personal ? '' : channelId);
            setOpenDoc(doc.id);
        } catch (err) {
            setError((err as Error).message);
        }
    };

    const archived = Boolean(channel?.delete_at);
    const channelName = channel?.type === 'D' || channel?.type === 'G' ? intl.formatMessage({id: 'whiteboard.list.conversation', defaultMessage: 'this conversation'}) : channel?.display_name;

    return (
        <div className={cx('app-panel', 'wb-list')}>
            {error && <div className={cx('wb-error')}>{error}</div>}
            {channel && (
                <Section
                    title={
                        <FormattedMessage
                            id='whiteboard.list.channel'
                            defaultMessage='Shared with {channel}'
                            values={{channel: channelName}}
                        />
                    }
                    docs={channelDocs}
                    empty={
                        <FormattedMessage
                            id='whiteboard.list.channel_empty'
                            defaultMessage='No boards here yet. Every member of the channel can draw on the boards added here.'
                        />
                    }
                    canCreate={!archived}
                    onCreate={() => create(false)}
                    createLabel={intl.formatMessage({id: 'whiteboard.list.new_channel', defaultMessage: 'New board in this channel'})}
                />
            )}
            <Section
                title={
                    <FormattedMessage
                        id='whiteboard.list.personal'
                        defaultMessage='Personal boards'
                    />
                }
                docs={personalDocs}
                empty={
                    <FormattedMessage
                        id='whiteboard.list.personal_empty'
                        defaultMessage='Only you can see your personal boards.'
                    />
                }
                canCreate={true}
                onCreate={() => create(true)}
                createLabel={intl.formatMessage({id: 'whiteboard.list.new_personal', defaultMessage: 'New personal board'})}
            />
        </div>
    );
}
