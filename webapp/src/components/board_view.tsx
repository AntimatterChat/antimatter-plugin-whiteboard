// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {ExcalidrawImperativeAPI} from '@excalidraw/excalidraw/types';
import React, {Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {Client4} from 'mattermost-redux/client';
import {getChannel, getCurrentChannel} from 'mattermost-redux/selectors/entities/channels';
import {getTeammateNameDisplaySetting, getTheme} from 'mattermost-redux/selectors/entities/preferences';
import {getCurrentTeamId} from 'mattermost-redux/selectors/entities/teams';
import {getCurrentUser} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import BoardSession, {type BoardUser} from '../board_session';
import {client, events} from '../client';
import {userColor} from '../colors';
import type {Doc} from '../relay/client';
import Icon from '../ui/icon';
import {useBoardTheme} from '../ui/theme';
import {cx} from '../ui/web_ui';
import {setOpenDoc} from '../ui_state';

import BoardHistory, {type BoardVersion} from './board_history';
import {confirmDialog} from './fusion/confirm_dialog';
import EmptyState from './fusion/empty_state';
import {iconTip} from './fusion/tip';
import LibraryManager from './library_manager';
import Menu, {type MenuItem} from './menu';
import ScopeChip, {FavoriteButton} from './scope';
import {useSteadyStatus} from './steady_status';
import {useSharedLibraries} from './use_libraries';

// Excalidraw is large: it's loaded when a board is opened.
const ExcalidrawCanvas = React.lazy(() => import(/* webpackChunkName: "excalidraw" */ '../excalidraw/canvas'));
const loadTools = () => import(/* webpackChunkName: "excalidraw" */ '../excalidraw/tools');

// mergeDoc returns a state update applying changes to a board.
function mergeDoc(changes: Partial<Doc>) {
    return (doc: Doc | null) => (doc ? {...doc, ...changes} : doc);
}

function useSession(docId: string, user: BoardUser) {
    const [session, setSession] = useState<BoardSession | null>(null);
    const [error, setError] = useState('');
    const userRef = useRef(user);
    userRef.current = user;

    useEffect(() => {
        const s = new BoardSession(client, docId, userRef.current);
        const removeListener = events.addDoc(s.connection);
        s.start().catch((err) => setError(err.message));
        setSession(s);
        setError('');

        // Don't lose the last changes when the window closes
        const warn = (e: BeforeUnloadEvent) => {
            if (s.connection.pending()) {
                e.preventDefault();
            }
        };
        window.addEventListener('beforeunload', warn);
        return () => {
            window.removeEventListener('beforeunload', warn);
            removeListener();
            s.destroy();
        };
    }, [docId]);

    const subscribe = useCallback((listener: () => void) => (session ? session.subscribe(listener) : () => null), [session]);
    useSyncExternalStore(subscribe, () => session?.version ?? -1);
    return {session, error};
}

function TitleInput({doc, editable}: {doc: Doc; editable: boolean}) {
    const {formatMessage} = useIntl();
    const [title, setTitle] = useState(doc.title);
    const [focused, setFocused] = useState(false);

    useEffect(() => {
        if (!focused) {
            setTitle(doc.title);
        }
    }, [doc.title, focused]);

    const save = () => {
        setFocused(false);
        if (title.trim() !== doc.title) {
            client.renameDoc(doc.id, title).catch(() => setTitle(doc.title));
        }
    };

    return (
        <input
            className={cx('wb-title')}
            value={title}
            readOnly={!editable}
            maxLength={200}
            aria-label={formatMessage({id: 'whiteboard.title', defaultMessage: 'Title'})}
            onFocus={() => setFocused(true)}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                } else if (e.key === 'Escape') {
                    setTitle(doc.title);
                }
            }}
        />
    );
}

function StatusText({session, editable}: {session: BoardSession; editable: boolean}) {
    const steady = useSteadyStatus(session.status);
    if (!editable) {
        return (
            <FormattedMessage
                id='whiteboard.status.read_only'
                defaultMessage='Read only'
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

// BoardView shows an open board: its title, its Excalidraw canvas and its actions.
export default function BoardView({docId}: {docId: string}) {
    const intl = useIntl();
    const me = useSelector(getCurrentUser);
    const nameSetting = useSelector(getTeammateNameDisplaySetting);
    const theme = useSelector(getTheme);
    const boardTheme = useBoardTheme(theme.centerChannelBg);
    const user: BoardUser = {
        userId: me.id,
        name: displayUsername(me, nameSetting),
        color: userColor(me.id),
        avatarUrl: Client4.getProfilePictureUrl(me.id, me.last_picture_update),
    };

    const [doc, setDoc] = useState<Doc | null>(null);
    const [docError, setDocError] = useState('');
    const [deleted, setDeleted] = useState(false);
    const [view, setView] = useState<'board' | 'history' | 'libraries'>('board');
    const [notice, setNotice] = useState('');
    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const onAPI = useCallback((api: ExcalidrawImperativeAPI | null) => {
        apiRef.current = api;
    }, []);
    const {session, error: sessionError} = useSession(docId, user);
    const channel = useSelector((state: GlobalState) => (doc?.channel_id ? getChannel(state, doc.channel_id) : null));
    const currentChannel = useSelector(getCurrentChannel);

    // The libraries of the board's community: its channel's team, or the current team for the boards without one
    const currentTeamId = useSelector(getCurrentTeamId);
    const shared = useSharedLibraries(Boolean(doc), doc?.channel_id, currentTeamId);
    const canManageLibraries = Boolean(shared.libraries?.can_manage_team || shared.libraries?.can_manage_server);
    const manageLibraries = useCallback(() => setView('libraries'), []);
    const libraryNote = useMemo(() => ({canManage: canManageLibraries, onManage: manageLibraries}), [canManageLibraries, manageLibraries]);

    useEffect(() => {
        client.getDoc(docId).then(setDoc, (err) => setDocError(err.status === 404 ? intl.formatMessage({id: 'whiteboard.not_found', defaultMessage: 'This board was deleted, or you can\'t open it.'}) : err.message));
    }, [docId, intl]);

    // Follow the renames and the deletion of the board
    useEffect(() => events.addListListener((change) => {
        if (change.doc.id !== docId) {
            return;
        }
        if (change.event === 'deleted') {
            setDeleted(true);
        } else {
            setDoc(mergeDoc(change.doc));
        }
    }), [docId]);

    const back = (
        <button
            className={cx('icon-btn')}
            {...iconTip(intl.formatMessage({id: 'whiteboard.back', defaultMessage: 'All boards'}))}
            onClick={() => {
                if (view !== 'board') {
                    setView('board');
                    return;
                }
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                }
                setOpenDoc(null);
            }}
        >
            <Icon name='chev'/>
        </button>
    );

    const loadingBoard = intl.formatMessage({id: 'whiteboard.loading', defaultMessage: 'Loading the board…', description: 'Shown while an open whiteboard and its drawing load.'});
    const cancelLabel = intl.formatMessage({id: 'whiteboard.confirm.cancel', defaultMessage: 'Cancel', description: 'Button closing a confirmation dialog of the Whiteboard app without doing anything.'});
    const failure = docError || sessionError || (deleted && intl.formatMessage({id: 'whiteboard.deleted', defaultMessage: 'This board was deleted.'}));
    if (failure || !doc || !session) {
        return (
            <div className={cx('wb-wrap')}>
                <div className={cx('wb-bar')}>{back}</div>
                {failure ? (
                    <EmptyState
                        tone='danger'
                        icon={<Icon name='draw'/>}
                        title={failure}
                        classicClassName={cx('wb-error')}
                        data-testid='board-failure'
                    />
                ) : (
                    <EmptyState
                        busy={true}
                        text={loadingBoard}
                        classicClassName={cx('wb-empty')}
                        data-testid='board-loading'
                    />
                )}
            </div>
        );
    }

    const editable = doc.can_edit && !session.readOnly;
    const withAPI = (action: (tools: Awaited<ReturnType<typeof loadTools>>, api: ExcalidrawImperativeAPI) => Promise<void> | void) => async () => {
        const api = apiRef.current;
        if (!api) {
            return;
        }
        try {
            await action(await loadTools(), api);
        } catch (err) {
            setNotice((err as Error).message);
        }
    };

    const items: MenuItem[] = [
        {
            icon: 'fullscreen',
            label: intl.formatMessage({id: 'whiteboard.menu.fullscreen', defaultMessage: 'Full screen'}),
            onClick: () => rootRef.current?.requestFullscreen?.(),
        },
        {
            icon: 'expand',
            label: intl.formatMessage({id: 'whiteboard.menu.fit', defaultMessage: 'Show the whole board'}),
            onClick: withAPI((_tools, api) => api.scrollToContent(api.getSceneElements(), {fitToContent: true, animate: true})),
        },
        {
            icon: 'export',
            label: intl.formatMessage({id: 'whiteboard.menu.download_scene', defaultMessage: 'Download as .excalidraw'}),
            onClick: withAPI((tools, api) => tools.downloadScene(api, doc.title)),
        },
        {
            icon: 'export',
            label: intl.formatMessage({id: 'whiteboard.menu.download_png', defaultMessage: 'Download as PNG'}),
            onClick: withAPI((tools, api) => tools.downloadPNG(api, doc.title)),
        },
        {
            icon: 'export',
            label: intl.formatMessage({id: 'whiteboard.menu.download_svg', defaultMessage: 'Download as SVG'}),
            onClick: withAPI((tools, api) => tools.downloadSVG(api, doc.title)),
        },
    ];
    items.push({
        icon: 'clock',
        label: intl.formatMessage({id: 'whiteboard.menu.history', defaultMessage: 'Version history'}),
        onClick: () => setView('history'),
    });
    if (canManageLibraries) {
        items.push({
            icon: 'library',
            label: intl.formatMessage({id: 'whiteboard.menu.libraries', defaultMessage: 'Manage libraries'}),
            onClick: manageLibraries,
        });
    }
    if (editable) {
        items.push({
            icon: 'upload',
            label: intl.formatMessage({id: 'whiteboard.menu.import', defaultMessage: 'Import an .excalidraw file…'}),
            onClick: () => fileRef.current?.click(),
        });
    }

    // A channel's board is shared in the channel once it has a title; one still untitled can be shared by hand.
    if (doc.channel_id && !doc.shared_post_id && !channel?.delete_at) {
        items.push({
            icon: 'forward',
            label: intl.formatMessage({id: 'whiteboard.menu.share', defaultMessage: 'Share in the channel'}),
            onClick: async () => {
                try {
                    await session.saveThumbnail();
                    await client.share(doc.id);
                    setNotice(intl.formatMessage({id: 'whiteboard.shared', defaultMessage: 'Shared in the channel.'}));
                } catch (err) {
                    setNotice((err as Error).message);
                }
            },
        });
    }

    // A personal board that should have been the channel's: it moves there, and is shared.
    const conversation = currentChannel?.type === 'D' || currentChannel?.type === 'G';
    if (!doc.channel_id && currentChannel && !currentChannel.delete_at) {
        items.push({
            icon: 'forward',
            label: conversation ? intl.formatMessage({id: 'whiteboard.menu.move_conversation', defaultMessage: 'Share in this conversation'}) : intl.formatMessage({id: 'whiteboard.menu.move', defaultMessage: 'Share in ~{channel}'}, {channel: currentChannel.display_name}),
            onClick: async () => {
                try {
                    await session.saveThumbnail();
                    setDoc(await client.moveDoc(doc.id, currentChannel.id));
                    setNotice(intl.formatMessage({id: 'whiteboard.moved', defaultMessage: 'Shared: everyone in the channel can see and draw on it now.'}));
                } catch (err) {
                    setNotice((err as Error).message);
                }
            },
        });
    }
    if (doc.can_delete) {
        items.push({
            icon: 'trash',
            label: intl.formatMessage({id: 'whiteboard.menu.delete', defaultMessage: 'Delete'}),
            danger: true,
            onClick: async () => {
                const yes = await confirmDialog({
                    title: intl.formatMessage({id: 'whiteboard.delete.title', defaultMessage: 'Delete "{title}"?', description: 'Title of the dialog confirming the deletion of a whiteboard; {title} is the board\'s title.'}, {title: doc.title}),
                    message: intl.formatMessage({id: 'whiteboard.delete.lead', defaultMessage: 'It\'s deleted for everyone. This can\'t be undone.', description: 'Sentence under the title of the dialog confirming the deletion of a whiteboard: what deleting it does.'}),
                    confirmLabel: intl.formatMessage({id: 'whiteboard.menu.delete', defaultMessage: 'Delete'}),
                    cancelLabel,
                    danger: true,
                    icon: 'trash',
                });
                if (yes) {
                    client.deleteDoc(doc.id).then(() => setOpenDoc(null), (err) => setNotice(err.message));
                }
            },
        });
    }

    const restore = (version: BoardVersion) => {
        withAPI((tools, api) => {
            tools.restoreVersion(api, version.elements, version.files);
            setView('board');
            setNotice(intl.formatMessage({id: 'whiteboard.restored', defaultMessage: 'Version restored. Undo to go back.'}));
        })();
    };

    const importFile = async (file: File) => {
        const yes = await confirmDialog({
            title: intl.formatMessage({id: 'whiteboard.import.title', defaultMessage: 'Replace the content of "{title}"?', description: 'Title of the dialog confirming the import of an .excalidraw file into a whiteboard; {title} is the board\'s title.'}, {title: doc.title}),
            message: intl.formatMessage({id: 'whiteboard.import.lead', defaultMessage: 'What\'s drawn on it is replaced by {file}, for everyone.', description: 'Sentence under the title of the dialog confirming the import of an .excalidraw file into a whiteboard; {file} is the name of the file.'}, {file: file.name}),
            confirmLabel: intl.formatMessage({id: 'whiteboard.import.replace', defaultMessage: 'Replace', description: 'Button of the dialog confirming the import of an .excalidraw file: replaces the board\'s content with the file\'s.'}),
            cancelLabel,
            danger: true,
            icon: 'upload',
        });
        if (yes) {
            withAPI((tools, api) => tools.importScene(api, file))();
        }
    };

    const boardLoading = (
        <EmptyState
            busy={true}
            text={loadingBoard}
            classicClassName={cx('wb-empty')}
            data-testid='board-loading'
        />
    );

    return (
        <div
            ref={rootRef}
            className={cx('wb-wrap', 'wb-board')}
        >
            <div className={cx('wb-bar')}>
                {back}
                {view === 'history' && (
                    <span className={cx('wb-title', 'wb-history-title')}>
                        <FormattedMessage
                            id='whiteboard.history.title'
                            defaultMessage='Versions of {title}'
                            values={{title: doc.title}}
                        />
                    </span>
                )}
                {view === 'libraries' && (
                    <span className={cx('wb-title', 'wb-history-title')}>
                        <FormattedMessage
                            id='whiteboard.libraries.title'
                            defaultMessage='Libraries'
                        />
                    </span>
                )}
                {view === 'board' && (
                    <TitleInput
                        doc={doc}
                        editable={editable}
                    />
                )}
                <FavoriteButton doc={doc}/>
                <ScopeChip doc={doc}/>
                <span className={cx('wb-status')}>
                    <StatusText
                        session={session}
                        editable={editable}
                    />
                </span>
                <Menu
                    label={intl.formatMessage({id: 'whiteboard.menu', defaultMessage: 'Board actions'})}
                    items={items}
                />
                <input
                    ref={fileRef}
                    type='file'
                    accept='.excalidraw,application/json,application/vnd.excalidraw+json'
                    style={{display: 'none'}}
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) {
                            importFile(file);
                        }
                    }}
                />
            </div>
            {notice && (
                <button
                    className={cx('wb-notice')}
                    onClick={() => setNotice('')}
                >
                    {notice}
                </button>
            )}
            <div className={cx('wb-canvas')}>
                <div className={cx('wb-excalidraw')}>
                    {session.status === 'loading' ? boardLoading : (
                        <Suspense fallback={boardLoading}>
                            <ExcalidrawCanvas
                                session={session}
                                title={doc.title}
                                editable={editable}
                                theme={boardTheme}
                                locale={me.locale || 'en'}
                                onAPI={onAPI}
                                sharedItems={shared.items}
                                libraryNote={libraryNote}
                            />
                        </Suspense>
                    )}
                </div>
                {view === 'libraries' && (
                    <div className={cx('wb-history-layer')}>
                        <LibraryManager where={{channelId: doc.channel_id, teamId: currentTeamId}}/>
                    </div>
                )}
                {view === 'history' && (
                    <div className={cx('wb-history-layer')}>
                        <BoardHistory
                            docId={doc.id}
                            dark={boardTheme === 'dark'}
                            canRestore={editable}
                            onRestore={restore}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
