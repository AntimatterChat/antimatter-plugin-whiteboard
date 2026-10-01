// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {ExcalidrawImperativeAPI} from '@excalidraw/excalidraw/types';
import React, {Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {Client4} from 'mattermost-redux/client';
import {getChannel} from 'mattermost-redux/selectors/entities/channels';
import {getTeammateNameDisplaySetting, getTheme} from 'mattermost-redux/selectors/entities/preferences';
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
import Menu, {type MenuItem} from './menu';

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
    if (!editable) {
        return (
            <FormattedMessage
                id='whiteboard.status.read_only'
                defaultMessage='Read only'
            />
        );
    }
    switch (session.status) {
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
    const [view, setView] = useState<'board' | 'history'>('board');
    const [notice, setNotice] = useState('');
    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const onAPI = useCallback((api: ExcalidrawImperativeAPI | null) => {
        apiRef.current = api;
    }, []);
    const {session, error: sessionError} = useSession(docId, user);
    const channel = useSelector((state: GlobalState) => (doc?.channel_id ? getChannel(state, doc.channel_id) : null));

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
            title={intl.formatMessage({id: 'whiteboard.back', defaultMessage: 'All boards'})}
            aria-label={intl.formatMessage({id: 'whiteboard.back', defaultMessage: 'All boards'})}
            onClick={() => {
                if (view === 'history') {
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

    const failure = docError || sessionError || (deleted && intl.formatMessage({id: 'whiteboard.deleted', defaultMessage: 'This board was deleted.'}));
    if (failure || !doc || !session) {
        return (
            <div className={cx('wb-wrap')}>
                <div className={cx('wb-bar')}>{back}</div>
                <div className={failure ? cx('wb-error') : cx('wb-empty')}>{failure || '…'}</div>
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
    if (editable) {
        items.push({
            icon: 'upload',
            label: intl.formatMessage({id: 'whiteboard.menu.import', defaultMessage: 'Import an .excalidraw file…'}),
            onClick: () => fileRef.current?.click(),
        });
    }
    if (doc.channel_id && !channel?.delete_at) {
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
    if (doc.can_delete) {
        items.push({
            icon: 'trash',
            label: intl.formatMessage({id: 'whiteboard.menu.delete', defaultMessage: 'Delete'}),
            danger: true,
            onClick: () => {
                // eslint-disable-next-line no-alert
                if (window.confirm(intl.formatMessage({id: 'whiteboard.delete.confirm', defaultMessage: 'Delete "{title}" for everyone? This can\'t be undone.'}, {title: doc.title}))) {
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

    const importFile = (file: File) => {
        // eslint-disable-next-line no-alert
        if (window.confirm(intl.formatMessage({id: 'whiteboard.import.confirm', defaultMessage: 'Replace the content of "{title}" with {file}, for everyone?'}, {title: doc.title, file: file.name}))) {
            withAPI((tools, api) => tools.importScene(api, file))();
        }
    };

    return (
        <div
            ref={rootRef}
            className={cx('wb-wrap', 'wb-board')}
        >
            <div className={cx('wb-bar')}>
                {back}
                {view === 'history' ? (
                    <span className={cx('wb-title', 'wb-history-title')}>
                        <FormattedMessage
                            id='whiteboard.history.title'
                            defaultMessage='Versions of {title}'
                            values={{title: doc.title}}
                        />
                    </span>
                ) : (
                    <TitleInput
                        doc={doc}
                        editable={editable}
                    />
                )}
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
                    {session.status === 'loading' ? <div className={cx('wb-empty')}>{'…'}</div> : (
                        <Suspense fallback={<div className={cx('wb-empty')}>{'…'}</div>}>
                            <ExcalidrawCanvas
                                session={session}
                                title={doc.title}
                                editable={editable}
                                theme={boardTheme}
                                locale={me.locale || 'en'}
                                onAPI={onAPI}
                            />
                        </Suspense>
                    )}
                </div>
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
