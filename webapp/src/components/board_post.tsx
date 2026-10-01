// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {useEffect, useState} from 'react';
import {FormattedMessage} from 'react-intl';

import type {Post} from '@mattermost/types/posts';

import {client} from '../client';
import type {Doc} from '../relay/client';
import Icon from '../ui/icon';
import {cx} from '../ui/web_ui';
import {openBoard} from '../ui_state';

import RelativeTime from './relative_time';

// The boards of the cards, loaded once per board.
const docs = new Map<string, Promise<Doc | null>>();

function loadDoc(docId: string) {
    let doc = docs.get(docId);
    if (!doc) {
        doc = client.getDoc(docId).catch(() => null);
        docs.set(docId, doc);
        setTimeout(() => docs.delete(docId), 60000);
    }
    return doc;
}

// BoardPost is the card of a board shared in a channel, with its thumbnail.
export default function BoardPost({post}: {post: Post}) {
    const docId = String(post.props?.doc_id || '');
    const [doc, setDoc] = useState<Doc | null | undefined>();
    const [thumbnail, setThumbnail] = useState(true);

    useEffect(() => {
        let cancelled = false;
        if (docId) {
            loadDoc(docId).then((d) => !cancelled && setDoc(d));
        }
        return () => {
            cancelled = true;
        };
    }, [docId]);

    const title = doc?.title || String(post.props?.title || '');
    const available = doc !== null;

    return (
        <div className={cx('card', 'compact', 'wb-card')}>
            <div className={cx('card-author')}>
                <Icon
                    name='draw'
                    size='sm'
                />
                <FormattedMessage
                    id='whiteboard.card.label'
                    defaultMessage='Shared whiteboard'
                />
            </div>
            <button
                className={cx('card-title')}
                disabled={!available}
                onClick={() => openBoard(docId)}
            >
                {title}
            </button>
            {doc && thumbnail && (
                <button
                    className={cx('wb-thumb')}
                    onClick={() => openBoard(docId)}
                >
                    <img
                        src={client.thumbnailURL(docId, doc.update_at)}
                        alt={title}
                        loading='lazy'
                        onError={() => setThumbnail(false)}
                    />
                </button>
            )}
            <div className={cx('card-foot')}>
                {doc === null ? (
                    <FormattedMessage
                        id='whiteboard.card.unavailable'
                        defaultMessage='This board was deleted, or you are not a member of its channel.'
                    />
                ) : doc && (
                    <FormattedMessage
                        id='whiteboard.card.edited'
                        defaultMessage='Edited {when}'
                        values={{when: <RelativeTime value={doc.update_at}/>}}
                    />
                )}
            </div>
            {available && (
                <div className={cx('card-actions')}>
                    <button
                        className={cx('primary')}
                        onClick={() => openBoard(docId)}
                    >
                        <FormattedMessage
                            id='whiteboard.card.open'
                            defaultMessage='Open board'
                        />
                    </button>
                </div>
            )}
        </div>
    );
}
