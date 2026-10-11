// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {useEffect, useRef, useState} from 'react';
import {useSelector} from 'react-redux';

import {getCurrentChannel} from 'mattermost-redux/selectors/entities/channels';

import {cx} from '../ui/web_ui';
import {panelClosed, panelOpened, useOpenDoc} from '../ui_state';

import BoardList from './board_list';
import BoardView from './board_view';

// BoardsPanel is the whiteboard app in the right-hand panel: the boards of the current channel
// and the personal boards, or the open board.
export default function BoardsPanel() {
    const channel = useSelector(getCurrentChannel);

    // Back in another channel than the one it was closed in, the panel opens on its list
    useState(() => panelOpened(channel?.id || ''));
    const channelId = useRef(channel?.id || '');
    channelId.current = channel?.id || '';
    useEffect(() => () => panelClosed(channelId.current), []);

    const docId = useOpenDoc();

    return (
        <div className={cx('wb-root')}>
            {docId ? (
                <BoardView
                    key={docId}
                    docId={docId}
                />
            ) : <BoardList channel={channel}/>}
        </div>
    );
}
