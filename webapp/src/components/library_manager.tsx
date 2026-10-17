// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import {client} from '../client';
import {formatSize, librariesChanged, type Libraries, type Library} from '../libraries';
import Icon from '../ui/icon';
import {cx} from '../ui/web_ui';

import {confirmDialog} from './fusion/confirm_dialog';
import EmptyState from './fusion/empty_state';
import {iconTip} from './fusion/tip';

// A scope of libraries: the server's (teamId empty), or a community's.
type LibraryScope = {
    teamId: string;
    title: React.ReactNode;
    canManage: boolean;
};

type Props = {

    // Where the libraries are listed from: the board's channel, or a team; none for the server's only.
    where: {channelId?: string; teamId?: string};

    // In the System Console: the server's libraries, with the classic markup whatever the web UI.
    admin?: boolean;
};

const classic = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).map((name) => 'amw-' + name).join(' ');

const ACCEPT = '.excalidrawlib,application/vnd.excalidrawlib+json,application/json';

// libraryFileName returns the name of a library from its file's name.
export function libraryFileName(fileName: string): string {
    return fileName.replace(/\.(excalidrawlib|json)$/i, '').trim();
}

function LibraryRow({library, canManage, c, admin, onRenamed, onDeleted, onError}: {
    library: Library;
    canManage: boolean;
    c: typeof cx;
    admin: boolean;
    onRenamed: (renamed: Library) => void;
    onDeleted: (deleted: Library) => void;
    onError: (message: string) => void;
}) {
    const intl = useIntl();
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(library.name);
    const [busy, setBusy] = useState(false);

    const save = async () => {
        setEditing(false);
        const trimmed = name.trim();
        if (!trimmed || trimmed === library.name) {
            setName(library.name);
            return;
        }
        setBusy(true);
        try {
            onRenamed(await client.renameLibrary(library.id, trimmed));
        } catch (err) {
            setName(library.name);
            onError((err as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        const yes = await confirmDialog({
            title: intl.formatMessage({id: 'whiteboard.libraries.delete.title', defaultMessage: 'Delete the library "{name}"?', description: 'Title of the dialog confirming the deletion of a library of shapes; {name} is the library\'s name.'}, {name: library.name}),
            message: intl.formatMessage({id: 'whiteboard.libraries.delete.lead', defaultMessage: 'Its shapes leave the library of every board.', description: 'Sentence under the title of the dialog confirming the deletion of a library of shapes: what deleting it does.'}),
            confirmLabel: intl.formatMessage({id: 'whiteboard.libraries.delete', defaultMessage: 'Delete'}),
            cancelLabel: intl.formatMessage({id: 'whiteboard.confirm.cancel', defaultMessage: 'Cancel', description: 'Button closing a confirmation dialog of the Whiteboard app without doing anything.'}),
            danger: true,
            icon: 'trash',
        });
        if (!yes) {
            return;
        }
        setBusy(true);
        try {
            await client.deleteLibrary(library.id);
            onDeleted(library);
        } catch (err) {
            onError((err as Error).message);
            setBusy(false);
        }
    };

    const renameLabel = intl.formatMessage({id: 'whiteboard.libraries.rename', defaultMessage: 'Rename'});
    const deleteLabel = intl.formatMessage({id: 'whiteboard.libraries.delete', defaultMessage: 'Delete'});

    // The System Console has neither Fusion's icons nor the plugin's: text buttons there
    const action = (label: string, onClick: () => void, icon: 'pen' | 'trash', danger = false) => (admin ? (
        <button
            type='button'
            className={'btn btn-tertiary btn-sm' + (danger ? ' amw-wb-lib-danger' : '')}
            disabled={busy}
            onClick={onClick}
        >
            {label}
        </button>
    ) : (
        <button
            type='button'
            className={c('icon-btn', 'wb-h-btn')}
            {...iconTip(label)}
            disabled={busy}
            onClick={onClick}
        >
            <Icon
                name={icon}
                size='sm'
            />
        </button>
    ));

    return (
        <div
            className={c(!admin && 'app-row', 'wb-lib-row')}
            data-testid='library-row'
        >
            {!admin && (
                <span className={c('wb-row-ic')}>
                    <Icon name='library'/>
                </span>
            )}
            <span className={c('wb-row-main')}>
                {editing ? (
                    <input
                        className={c('wb-lib-name')}
                        value={name}
                        maxLength={100}
                        autoFocus={true}
                        aria-label={intl.formatMessage({id: 'whiteboard.libraries.name', defaultMessage: 'Name of the library'})}
                        onChange={(e) => setName(e.target.value)}
                        onBlur={save}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                            } else if (e.key === 'Escape') {
                                setName(library.name);
                                setEditing(false);
                            }
                        }}
                    />
                ) : <b>{library.name}</b>}
                <span className={c('sub')}>
                    <FormattedMessage
                        id='whiteboard.libraries.count'
                        defaultMessage='{count, plural, one {# shape} other {# shapes}} · {size}'
                        values={{count: library.item_count, size: formatSize(library.size)}}
                    />
                </span>
            </span>
            {canManage && (
                <span className={c('wb-lib-actions')}>
                    {action(renameLabel, () => setEditing(true), 'pen')}
                    {action(deleteLabel, remove, 'trash', true)}
                </span>
            )}
        </div>
    );
}

// LibraryManager lists the libraries of the server and of a community, and lets their admins add
// .excalidrawlib files, rename and delete them.
export default function LibraryManager({where, admin = false}: Props) {
    const intl = useIntl();
    const c = admin ? classic : cx;
    const [libraries, setLibraries] = useState<Libraries | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [uploading, setUploading] = useState('');
    const inputs = useRef<Record<string, HTMLInputElement | null>>({});

    const {channelId, teamId} = where;
    const load = useCallback(() => {
        client.listLibraries({channelId, teamId}).then(setLibraries, (err) => setError(err.message));
    }, [channelId, teamId]);
    useEffect(load, [load]);

    const changed = () => {
        librariesChanged();
        load();
    };

    const upload = async (scope: LibraryScope, file: File) => {
        setError('');
        setNotice('');
        setUploading(scope.teamId || 'server');
        try {
            const {library, skipped_items: skipped} = await client.uploadLibrary(file, libraryFileName(file.name), scope.teamId);
            setNotice(intl.formatMessage({
                id: 'whiteboard.libraries.added',
                defaultMessage: 'Added "{name}": {count, plural, one {# shape} other {# shapes}}.{skipped, plural, =0 {} one { # shape with images or web pages was left out.} other { # shapes with images or web pages were left out.}}',
            }, {name: library.name, count: library.item_count, skipped}));
            changed();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setUploading('');
        }
    };

    // Nothing (yet) in a scope: Fusion's empty state in a board, the classic line in the System Console.
    const empty = (busy: boolean, text: string) => (admin ? <div className={c('wb-empty')}>{text}</div> : (
        <EmptyState
            busy={busy}
            icon={<Icon name='library'/>}
            text={text}
            classicClassName={c('wb-empty')}
            data-testid='libraries-empty'
        />
    ));

    const scopes: LibraryScope[] = [];
    if (libraries?.team_id && !admin) {
        scopes.push({
            teamId: libraries.team_id,
            title: (
                <FormattedMessage
                    id='whiteboard.libraries.community'
                    defaultMessage='This community'
                />
            ),
            canManage: libraries.can_manage_team,
        });
    }
    scopes.push({
        teamId: '',
        title: admin ? (
            <FormattedMessage
                id='whiteboard.libraries.server_wide'
                defaultMessage='Libraries for every community'
            />
        ) : (
            <FormattedMessage
                id='whiteboard.libraries.server'
                defaultMessage='Every community of the server'
            />
        ),
        canManage: Boolean(libraries?.can_manage_server),
    });

    return (
        <div className={c('wb-libs', admin && 'wb-libs-admin')}>
            {error && <div className={c('wb-error')}>{error}</div>}
            {notice && <div className={c('wb-notice')}>{notice}</div>}
            {scopes.map((scope) => {
                const key = scope.teamId || 'server';
                const shown = libraries?.libraries.filter((l) => l.team_id === scope.teamId) || null;
                const addLabel = intl.formatMessage({id: 'whiteboard.libraries.add', defaultMessage: 'Add a library (.excalidrawlib)'});
                return (
                    <section
                        key={key}
                        className={c('wb-libs-scope')}
                    >
                        <div className={c('app-h')}>
                            <span className={c('grow')}>{scope.title}</span>
                            {scope.canManage && (
                                <>
                                    <button
                                        type='button'
                                        className={admin ? 'btn btn-primary btn-sm' : c('icon-btn', 'wb-h-btn')}

                                        // The System Console keeps the classic markup, and the browser's tooltip
                                        {...(admin ? {title: addLabel, 'aria-label': addLabel} : iconTip(addLabel))}
                                        disabled={Boolean(uploading)}
                                        onClick={() => inputs.current[key]?.click()}
                                    >
                                        {admin ? (
                                            <FormattedMessage
                                                id='whiteboard.libraries.add_short'
                                                defaultMessage='Add a library'
                                            />
                                        ) : (
                                            <Icon
                                                name='plus'
                                                size='sm'
                                            />
                                        )}
                                    </button>
                                    <input
                                        ref={(el) => {
                                            inputs.current[key] = el;
                                        }}
                                        type='file'
                                        accept={ACCEPT}
                                        style={{display: 'none'}}
                                        data-testid={`library-file-${key}`}
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            e.target.value = '';
                                            if (file) {
                                                upload(scope, file);
                                            }
                                        }}
                                    />
                                </>
                            )}
                        </div>
                        {uploading === key && empty(true, intl.formatMessage({id: 'whiteboard.libraries.adding', defaultMessage: 'Adding the library…', description: 'Shown while a library of shapes (.excalidrawlib file) is being uploaded.'}))}
                        {shown?.length ? shown.map((library) => (
                            <LibraryRow
                                key={library.id}
                                library={library}
                                canManage={scope.canManage}
                                c={c}
                                admin={admin}
                                onRenamed={changed}
                                onDeleted={changed}
                                onError={setError}
                            />
                        )) : empty(!shown, shown ? intl.formatMessage({id: 'whiteboard.libraries.empty', defaultMessage: 'No libraries yet.'}) : intl.formatMessage({id: 'whiteboard.libraries.loading', defaultMessage: 'Loading the libraries…', description: 'Shown while the libraries of shapes of a community or of the server load.'}))}
                    </section>
                );
            })}
            <p className={c('wb-libs-help')}>
                <FormattedMessage
                    id='whiteboard.libraries.help'
                    defaultMessage='A library is an .excalidrawlib file (5 MB at most), as Excalidraw exports them from its library. Its shapes show in the library of the boards, for everyone in its community, or on the whole server.'
                />
            </p>
            {admin && (
                <p className={c('wb-libs-help')}>
                    <FormattedMessage
                        id='whiteboard.libraries.help_admin'
                        defaultMessage='The admins of each community add its own libraries from the Whiteboard app: Manage libraries, in the menu of a board.'
                    />
                </p>
            )}
        </div>
    );
}
