// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import './public_path';

import React from 'react';
import {FormattedMessage} from 'react-intl';

import {Client4} from 'mattermost-redux/client';

import {events} from './client';
import BoardPost from './components/board_post';
import BoardsPanel from './components/boards_panel';
import manifest from './manifest';
import {RelayEvents} from './relay/events';
import type {PluginClass, PluginRegistry, PluginStore, RightHandSidebarRegistration} from './types/host';
import Icon from './ui/icon';
import {setShowPanel} from './ui_state';

import './styles.css';

// The type of the posts sharing a board (server/api.go).
const BOARD_POST_TYPE = 'custom_am_whiteboard';

// The icon of the app bar: the mockup's whiteboard icon, in its color.
const appBarIcon = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#FB923C" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="8" height="8" rx="1.5"/><circle cx="16.5" cy="16.5" r="4.5"/><path d="M4 20c2-3 4-3 6-6"/></svg>',
);

const title = (
    <FormattedMessage
        id='whiteboard.app'
        defaultMessage='Whiteboard'
    />
);

export default class Plugin implements PluginClass {
    public initialize(registry: PluginRegistry, store: PluginStore) {
        if (window.basename) {
            Client4.setUrl(window.basename);
        }

        for (const event of Object.values(RelayEvents)) {
            registry.registerWebSocketEventHandler(`custom_${manifest.id}_${event}`, (msg) => events.handle(event, msg.data));
        }
        registry.registerReconnectHandler(() => events.reconnected());

        // The app bar opens the whiteboard panel; hosts without it get a channel header button.
        let rhs: RightHandSidebarRegistration;
        const appBar = registry.registerAppBarComponent?.({iconUrl: appBarIcon, tooltipText: title, rhsComponent: BoardsPanel, rhsTitle: title});
        if (appBar && typeof appBar === 'object') {
            rhs = appBar.rhsComponent;
        } else {
            rhs = registry.registerRightHandSidebarComponent(BoardsPanel, title);
        }
        registry.registerChannelHeaderButtonAction(
            <Icon name='draw'/>,
            () => store.dispatch(rhs.toggleRHSPlugin),
            title,
            title,
        );
        setShowPanel(() => store.dispatch(rhs.showRHSPlugin));

        registry.registerPostTypeComponent(BOARD_POST_TYPE, BoardPost);
    }
}

window.registerPlugin(manifest.id, new Plugin());
