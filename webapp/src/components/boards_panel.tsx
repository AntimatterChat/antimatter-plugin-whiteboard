// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {useSelector} from 'react-redux';

import {getCurrentChannel} from 'mattermost-redux/selectors/entities/channels';

import {panelStateOf, parsePanelState} from '../panel_state';
import {cx} from '../ui/web_ui';
import {panelClosed, panelOpened, panelRestored, restorePanel, useListView, useOpenDoc} from '../ui_state';

import BoardList from './board_list';
import BoardView from './board_view';

// The props the host gives the panel (Antimatter's Fusion UI): where the panel is goes to setPanelState, and a
// panel opened in a new window gets the state it had as initialPanelState. Other hosts give neither.
type Props = {
    setPanelState?: (state: string | null) => void;
    initialPanelState?: string;
};

// BoardsPanel is the whiteboard app in the right-hand panel: the boards of the current channel
// and the personal boards, or the open board.
export default function BoardsPanel({setPanelState, initialPanelState}: Props) {
    const channel = useSelector(getCurrentChannel);

    // Back in another channel than the one it was closed in, the panel opens on its list. Opened in a new window,
    // it starts where it was: the board, or the list it showed. The board is fetched again as the person signed in
    // here, so one they can no longer open shows its not-found view, with the way back to the list.
    const [restored] = useState(() => {
        panelOpened(channel?.id || '');
        const place = parsePanelState(initialPanelState);
        if (place) {
            restorePanel(place.docId, place.listView);
        }
        return place;
    });
    useLayoutEffect(() => {
        if (restored) {
            panelRestored();
        }
    }, [restored]);
    const channelId = useRef(channel?.id || '');
    channelId.current = channel?.id || '';
    useEffect(() => () => panelClosed(channelId.current), []);

    const docId = useOpenDoc();
    const listView = useListView();

    const state = panelStateOf({docId, listView});
    useEffect(() => {
        setPanelState?.(state || null);
    }, [setPanelState, state]);

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
