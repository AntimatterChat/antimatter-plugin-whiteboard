// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type React from 'react';
import type {AnyAction, Reducer, Store} from 'redux';

import type {Channel} from '@mattermost/types/channels';
import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';

import type {WebUI} from '../ui/web_ui';

export type RightHandSidebarRegistration = {
    id: string;
    showRHSPlugin: AnyAction;
    hideRHSPlugin: AnyAction;
    toggleRHSPlugin: AnyAction;
};

export type WebSocketMessage<T = Record<string, unknown>> = {
    event: string;
    data: T;
    broadcast: {channel_id: string; team_id: string; user_id: string};
};

// The subset of the host's plugin registry this plugin uses. Hooks that older hosts may lack
// are optional: the plugin checks for them before use.
export interface PluginRegistry {
    registerReducer(reducer: Reducer): void;
    registerWebSocketEventHandler(event: string, handler: (msg: WebSocketMessage) => void): void;
    registerReconnectHandler(handler: () => void): void;
    registerRightHandSidebarComponent(component: React.ComponentType, title: React.ReactNode): RightHandSidebarRegistration;
    registerChannelHeaderButtonAction(icon: React.ReactNode, action: (channel: Channel) => void, dropdownText: React.ReactNode, tooltipText: React.ReactNode): string;
    registerPostTypeComponent(type: string, component: React.ComponentType<{post: Post}>): string;
    registerAppBarComponent?(options: {
        iconUrl: string;
        tooltipText: React.ReactNode;
        rhsComponent: React.ComponentType;
        rhsTitle: React.ReactNode;
    }): {id: string; rhsComponent: RightHandSidebarRegistration} | string;
}

export type PluginStore = Store<GlobalState>;

export interface PluginClass {
    initialize(registry: PluginRegistry, store: PluginStore): void | Promise<void>;
    uninitialize?(): void;
}

declare global {
    interface Window {
        registerPlugin(pluginId: string, plugin: PluginClass): void;
        basename?: string;

        // Set by the Antimatter web UIs before plugins load
        antimatterWebUI?: WebUI;

        // Where Excalidraw loads its fonts from
        EXCALIDRAW_ASSET_PATH?: string | string[];
    }
}
