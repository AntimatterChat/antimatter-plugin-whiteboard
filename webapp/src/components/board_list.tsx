// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';

import type {Channel} from '@mattermost/types/channels';

import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {client, events} from '../client';
import type {Doc} from '../relay/client';
import Icon, {type IconName} from '../ui/icon';
import {cx, isFusionUI} from '../ui/web_ui';
import {setListView, setOpenDoc, useListView} from '../ui_state';

import EmptyState from './fusion/empty_state';
import {iconTip} from './fusion/tip';
import {useDisplayName} from './hooks';
import RelativeTime from './relative_time';
import ScopeChip from './scope';

// showScope tells where it's shared (or that it's personal), in the favorites, which mix them.
function BoardRow({doc, showScope = false}: {doc: Doc; showScope?: boolean}) {
    const editor = useDisplayName(doc.updated_by || doc.creator_id);
    return (
        <button
            className={cx('app-row')}
            onClick={() => setOpenDoc(doc.id)}
        >
            <span className={cx('wb-row-ic', !doc.channel_id && 'wb-row-personal')}>
                <Icon name='draw'/>
                {!doc.channel_id && (
                    <span className={cx('wb-row-lock')}>
                        <Icon
                            name='lock'
                            size='xs'
                        />
                    </span>
                )}
            </span>
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
            {showScope ? <ScopeChip doc={doc}/> : !doc.can_edit && <span className={cx('sub')}><Icon name='lock'/></span>}
        </button>
    );
}

type SectionProps = {
    showScope?: boolean;
    title: React.ReactNode;
    docs: Doc[] | null;
    empty: React.ReactNode;

    // The icon of its empty state, under Fusion
    emptyIcon: IconName;
    canCreate: boolean;
    onCreate: () => void;
    createLabel: string;
};

function Section({title, docs, empty, emptyIcon, canCreate, onCreate, createLabel, showScope = false}: SectionProps) {
    const intl = useIntl();

    // Under Fusion, the one thing to do from an empty list: a new board (the classic UI keeps its + only)
    const createAction = {
        label: createLabel,
        onClick: onCreate,
        icon: (
            <Icon
                name='plus'
                size='sm'
            />
        ),
    };
    return (
        <>
            <div className={cx('app-h')}>
                <span className={cx('grow')}>{title}</span>
                {canCreate && (
                    <button
                        className={cx('icon-btn', 'wb-h-btn')}
                        {...iconTip(createLabel)}
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
                    showScope={showScope}
                />
            )) : (
                <EmptyState
                    busy={!docs}
                    icon={<Icon name={emptyIcon}/>}
                    text={docs ? empty : intl.formatMessage({id: 'whiteboard.list.loading', defaultMessage: 'Loading the boards…', description: 'Shown while a list of whiteboards (the channel\'s, the favourites or the personal ones) loads.'})}
                    {...(docs && canCreate && isFusionUI() ? {action: createAction} : {})}
                    classicClassName={cx('wb-empty')}
                    data-testid='boards-empty'
                />
            )}
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
    const [favoriteDocs, setFavoriteDocs] = useState<Doc[] | null>(null);
    const [error, setError] = useState('');
    const view = useListView();

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

    const favoriteIds = useMemo(() => new Set((favoriteDocs || []).map((f) => f.id)), [favoriteDocs]);

    // The favorites, from any channel, load when shown
    const loadFavorites = useCallback(() => {
        client.listFavorites().then(setFavoriteDocs, () => setFavoriteDocs([]));
    }, []);
    useEffect(() => {
        if (view === 'favorites') {
            loadFavorites();
        }
    }, [view, loadFavorites]);

    useEffect(() => events.addListListener(({doc}) => {
        if (doc.channel_id && doc.channel_id === channelId) {
            loadChannel();
        } else if (!doc.channel_id && doc.owner_id === me) {
            loadPersonal();
        }
        if (view === 'favorites' && favoriteIds.has(doc.id)) {
            loadFavorites();
        }
    }), [channelId, me, loadChannel, loadPersonal, view, favoriteIds, loadFavorites]);

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

    const shown = channel || view === 'favorites' ? view : 'mine';
    const conversation = channel?.type === 'D' || channel?.type === 'G';

    return (
        <div className={cx('app-panel', 'wb-list')}>
            {channel && (
                <div
                    className={cx('seg', 'wb-seg')}
                    role='tablist'
                >
                    <button
                        type='button'
                        role='tab'
                        aria-selected={shown === 'channel'}
                        className={shown === 'channel' ? cx('on') : ''}
                        onClick={() => setListView('channel')}
                    >
                        {conversation ? (
                            <FormattedMessage
                                id='whiteboard.list.view_conversation'
                                defaultMessage='This conversation'
                            />
                        ) : (
                            <FormattedMessage
                                id='whiteboard.list.view_channel'
                                defaultMessage='This channel'
                            />
                        )}
                    </button>
                    <button
                        type='button'
                        role='tab'
                        aria-selected={shown === 'favorites'}
                        className={shown === 'favorites' ? cx('on') : ''}
                        onClick={() => setListView('favorites')}
                    >
                        <FormattedMessage
                            id='whiteboard.list.view_favorites'
                            defaultMessage='Favorites'
                        />
                    </button>
                    <button
                        type='button'
                        role='tab'
                        aria-selected={shown === 'mine'}
                        className={shown === 'mine' ? cx('on') : ''}
                        onClick={() => setListView('mine')}
                    >
                        <FormattedMessage
                            id='whiteboard.list.view_mine'
                            defaultMessage='Mine'
                        />
                    </button>
                </div>
            )}
            {error && <div className={cx('wb-error')}>{error}</div>}
            {shown === 'favorites' && (
                <Section
                    title={
                        <FormattedMessage
                            id='whiteboard.list.favorites'
                            defaultMessage='Favorites'
                        />
                    }
                    docs={favoriteDocs}
                    empty={
                        <FormattedMessage
                            id='whiteboard.list.favorites_empty'
                            defaultMessage='Star a board to find it here, wherever it is.'
                        />
                    }
                    emptyIcon='star'
                    canCreate={false}
                    onCreate={() => null}
                    createLabel=''
                    showScope={true}
                />
            )}
            {shown === 'channel' && channel && (
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
                    emptyIcon='draw'
                    canCreate={!archived}
                    onCreate={() => create(false)}
                    createLabel={intl.formatMessage({id: 'whiteboard.list.new_channel', defaultMessage: 'New board in this channel'})}
                />
            )}
            {shown === 'mine' && (
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
                    emptyIcon='lock'
                    canCreate={true}
                    onCreate={() => create(true)}
                    createLabel={intl.formatMessage({id: 'whiteboard.list.new_personal', defaultMessage: 'New personal board'})}
                />
            )}
        </div>
    );
}
