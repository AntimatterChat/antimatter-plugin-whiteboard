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
            type='button'
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
                        values={{
                            when: (
                                <RelativeTime
                                    key='when'
                                    value={doc.update_at}
                                />
                            ),
                            name: editor || '…',
                        }}
                    />
                </span>
            </span>
            {showScope ? <ScopeChip doc={doc}/> : !doc.can_edit && <span className={cx('sub')}><Icon name='lock'/></span>}
        </button>
    );
}

type SectionProps = {
    showScope?: boolean;

    // What the view is: "Shared with {channel}", "Favourites" or "Personal boards", on the left of its header row
    title: React.ReactNode;
    docs: Doc[] | null;

    // What the view shows without boards: an icon (under Fusion), a title and a sentence.
    empty: {icon: IconName; title: string; text: string};

    // The + on the right of the header row, making a board in the view's scope: none in the favourites, nor in an
    // archived channel. Under Fusion, the empty view also offers it as its one action.
    create?: {label: string; onClick: () => void} | null;
};

// Section is the boards of the view picked in the tabs above it: a header row (what the view is, and the + making a
// board there), then the boards, or the view's empty state.
function Section({title, docs, empty, create, showScope = false}: SectionProps) {
    const intl = useIntl();
    const plusIcon = (
        <Icon
            name='plus'
            size='sm'
        />
    );
    let body: React.ReactNode;
    if (docs?.length) {
        body = docs.map((doc) => (
            <BoardRow
                key={doc.id}
                doc={doc}
                showScope={showScope}
            />
        ));
    } else if (docs) {
        body = (
            <EmptyState
                icon={<Icon name={empty.icon}/>}
                title={empty.title}
                text={empty.text}
                {...(create && isFusionUI() ? {action: {...create, icon: plusIcon}} : {})}
                classicClassName={cx('wb-empty')}
                data-testid='boards-empty'
            />
        );
    } else {
        body = (
            <EmptyState
                busy={true}
                text={intl.formatMessage({id: 'whiteboard.list.loading', defaultMessage: 'Loading the boards…', description: 'Shown while a list of whiteboards (the channel\'s, the favourites or the personal ones) loads.'})}
                classicClassName={cx('wb-empty')}
                data-testid='boards-empty'
            />
        );
    }
    return (
        <>
            <div
                className={cx('app-h')}
                data-testid='boards-section-head'
            >
                <span className={cx('grow')}>{title}</span>
                {create && (
                    <button
                        type='button'
                        className={cx('icon-btn', 'wb-h-btn')}
                        {...iconTip(create.label)}
                        onClick={create.onClick}
                    >
                        {plusIcon}
                    </button>
                )}
            </div>
            {body}
        </>
    );
}

const byUpdate = (a: Doc, b: Doc) => b.update_at - a.update_at;

// BoardList lists the boards of the current channel, the user's favourites or their personal boards: the tabs, then
// the view's header row (what it is, and the + making a board there) and its boards.
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
    const conversation = channel?.type === 'D' || channel?.type === 'G';
    const channelName = conversation ? intl.formatMessage({id: 'whiteboard.list.conversation', defaultMessage: 'this conversation'}) : channel?.display_name;

    const shown = channel || view === 'favorites' ? view : 'mine';
    const newInChannel = conversation ? intl.formatMessage({id: 'whiteboard.list.new_conversation', defaultMessage: 'New board in this conversation', description: 'The + of the Whiteboard panel\'s "Shared with this conversation" row, in a direct or group message.'}) : intl.formatMessage({id: 'whiteboard.list.new_channel', defaultMessage: 'New board in this channel'});

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
                            defaultMessage='Favourites'
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
                    title={intl.formatMessage({id: 'whiteboard.list.favorites', defaultMessage: 'Favourites'})}
                    docs={favoriteDocs}
                    empty={{
                        icon: 'star',
                        title: intl.formatMessage({id: 'whiteboard.list.starred_empty_title', defaultMessage: 'Nothing starred yet', description: 'Title of the empty Favourites view of the Whiteboard panel: the person has starred no board.'}),
                        text: intl.formatMessage({id: 'whiteboard.list.favorites_empty', defaultMessage: 'Star a board to find it here, wherever it is.'}),
                    }}
                    showScope={true}
                />
            )}
            {shown === 'channel' && channel && (
                <Section
                    title={intl.formatMessage({id: 'whiteboard.list.channel', defaultMessage: 'Shared with {channel}'}, {channel: channelName})}
                    docs={channelDocs}
                    empty={{
                        icon: 'draw',
                        title: intl.formatMessage({id: 'whiteboard.list.channel_empty_title', defaultMessage: 'No boards here yet', description: 'Title of the Whiteboard panel when the current channel or conversation has no boards.'}),
                        text: conversation ? intl.formatMessage({id: 'whiteboard.list.conversation_empty_text', defaultMessage: 'Every member of the conversation can draw on the boards added here.', description: 'Under "No boards here yet" in the Whiteboard panel, in a direct or group message: who can draw on its boards.'}) : intl.formatMessage({id: 'whiteboard.list.channel_empty_text', defaultMessage: 'Every member of the channel can draw on the boards added here.', description: 'Under "No boards here yet" in the Whiteboard panel: who can draw on a channel\'s boards.'}),
                    }}
                    create={archived ? null : {label: newInChannel, onClick: () => create(false)}}
                />
            )}
            {shown === 'mine' && (
                <Section
                    title={intl.formatMessage({id: 'whiteboard.list.personal', defaultMessage: 'Personal boards'})}
                    docs={personalDocs}
                    empty={{
                        icon: 'lock',
                        title: intl.formatMessage({id: 'whiteboard.list.personal_empty_title', defaultMessage: 'No personal boards yet', description: 'Title of the personal ("Mine") view of the Whiteboard panel when the person has no personal boards.'}),
                        text: intl.formatMessage({id: 'whiteboard.list.personal_empty', defaultMessage: 'Only you can see your personal boards.'}),
                    }}
                    create={{label: intl.formatMessage({id: 'whiteboard.list.new_personal', defaultMessage: 'New personal board'}), onClick: () => create(true)}}
                />
            )}
        </div>
    );
}
