// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {useEffect, useState} from 'react';
import {FormattedDate, FormattedMessage, FormattedTime} from 'react-intl';

import type {BoardFile} from '../board_session';
import {client} from '../client';
import type {Version} from '../relay/client';
import {decodeScene, imageFileIds, type SceneElement} from '../scene';
import {cx} from '../ui/web_ui';

const loadTools = () => import(/* webpackChunkName: "excalidraw" */ '../excalidraw/tools');

// A past version of a board: its elements and their images.
export type BoardVersion = {
    elements: SceneElement[];
    files: BoardFile[];
};

// loadVersion reads a past version of a board, with the images it shows (those still kept).
export async function loadVersion(docId: string, seq: number): Promise<BoardVersion> {
    const elements = decodeScene(await client.getVersion(docId, seq)).filter((e) => !e.isDeleted);
    const files = await Promise.all(imageFileIds(elements).map((id) => client.getFile(docId, id).catch(() => null)));
    return {elements, files: files.filter((f): f is BoardFile => f !== null)};
}

type Props = {
    docId: string;
    dark: boolean;
    canRestore: boolean;
    onRestore: (version: BoardVersion) => void;
};

// BoardHistory lists the past versions of a board, shows them and restores them.
export default function BoardHistory({docId, dark, canRestore, onRestore}: Props) {
    const [versions, setVersions] = useState<Version[] | null>(null);
    const [selected, setSelected] = useState<number | null>(null);
    const [version, setVersion] = useState<BoardVersion | null>(null);
    const [preview, setPreview] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        client.getVersions(docId).then((v) => setVersions([...v].reverse()), (err) => setError(err.message));
    }, [docId]);

    useEffect(() => {
        setVersion(null);
        setPreview('');
        if (selected === null) {
            return () => null;
        }
        let cancelled = false;
        let url = '';
        (async () => {
            try {
                const loaded = await loadVersion(docId, selected);
                const svg = await (await loadTools()).versionSVG(loaded.elements, loaded.files, dark);
                if (!cancelled) {
                    url = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
                    setVersion(loaded);
                    setPreview(url);
                }
            } catch (err) {
                if (!cancelled) {
                    setError((err as Error).message);
                }
            }
        })();
        return () => {
            cancelled = true;
            if (url) {
                URL.revokeObjectURL(url);
            }
        };
    }, [docId, selected, dark]);

    if (error) {
        return <div className={cx('wb-error')}>{error}</div>;
    }
    if (!versions) {
        return <div className={cx('wb-empty')}>{'…'}</div>;
    }
    if (!versions.length) {
        return (
            <div className={cx('wb-empty')}>
                <FormattedMessage
                    id='whiteboard.history.empty'
                    defaultMessage='No past versions yet. Versions are kept every 10 minutes or so while a board is drawn on.'
                />
            </div>
        );
    }

    return (
        <div className={cx('wb-history')}>
            <div className={cx('wb-versions')}>
                {versions.map((v) => (
                    <button
                        key={v.seq}
                        className={cx('wb-version', selected === v.seq && 'on')}
                        aria-pressed={selected === v.seq}
                        onClick={() => setSelected(v.seq)}
                    >
                        <FormattedDate
                            value={v.at}
                            month='short'
                            day='numeric'
                        />
                        {' '}
                        <FormattedTime value={v.at}/>
                    </button>
                ))}
            </div>
            {selected !== null && !preview && <div className={cx('wb-empty')}>{'…'}</div>}
            {version && preview && (
                <>
                    <div className={cx('wb-preview')}>
                        {version.elements.length ? (
                            <img
                                src={preview}
                                alt=''
                            />
                        ) : (
                            <FormattedMessage
                                id='whiteboard.history.blank'
                                defaultMessage='The board was empty.'
                            />
                        )}
                    </div>
                    {canRestore && (
                        <div className={cx('wb-history-actions')}>
                            <button
                                className={cx('btn', 'primary')}
                                onClick={() => onRestore(version)}
                            >
                                <FormattedMessage
                                    id='whiteboard.history.restore'
                                    defaultMessage='Restore this version'
                                />
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
