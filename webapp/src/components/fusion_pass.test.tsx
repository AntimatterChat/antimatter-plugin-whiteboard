// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import React from 'react';
import {IntlProvider} from 'react-intl';
import {Provider} from 'react-redux';
import {legacy_createStore as createStore} from 'redux';

import type {Channel} from '@mattermost/types/channels';
import type {Post} from '@mattermost/types/posts';

import {client} from '../client';
import type {Doc} from '../relay/client';
import {setListView, setOpenDoc} from '../ui_state';

import BoardPost from './board_post';
import BoardsPanel from './boards_panel';
import {FUSION_LAYER_ID} from './fusion/fusion_ui';
import LibraryManager from './library_manager';

// The Whiteboard app under the Fusion UI: its confirmations are Fusion's dialogs, its tooltips Fusion's, its empty
// and loading states Fusion's, in the app's colour; under the classic UI, it keeps the classic ones.

jest.mock('mattermost-redux/client', () => ({Client4: {getProfilePictureUrl: () => '', getProfilesByIds: jest.fn(() => Promise.resolve([]))}}));

jest.mock('../client', () => ({
    client: {
        listDocs: jest.fn(),
        listFavorites: jest.fn(),
        createDoc: jest.fn(),
        getDoc: jest.fn(),
        renameDoc: jest.fn(),
        deleteDoc: jest.fn(),
        setFavorite: jest.fn(),
        moveDoc: jest.fn(),
        getVersions: jest.fn(),
        share: jest.fn(),
        thumbnailURL: () => '',
        listLibraries: jest.fn(),
        deleteLibrary: jest.fn(),
        renameLibrary: jest.fn(),
        uploadLibrary: jest.fn(),
    },
    events: {addDoc: () => () => null, addListListener: () => () => null},
}));

// The session of an open board, loaded: the canvas is drawn
jest.mock('../board_session', () => ({
    __esModule: true,
    default: class {
        status = 'saved';
        readOnly = false;
        version = 0;
        connection = {pending: () => false};
        start() {
            return Promise.resolve();
        }
        subscribe() {
            return () => null;
        }
        others() {
            return [];
        }
        destroy() {
            return null;
        }
    },
}));

// The canvas (Excalidraw), which gives the board its API once drawn
jest.mock('../excalidraw/canvas', () => {
    const {createElement, useEffect} = jest.requireActual('react');
    return {
        __esModule: true,
        default: ({onAPI}: {onAPI: (api: unknown) => void}) => {
            useEffect(() => onAPI({fake: 'api'}), [onAPI]);
            return createElement('div', {'data-testid': 'canvas'});
        },
    };
});
jest.mock('../excalidraw/tools', () => ({importScene: jest.fn()}));
jest.mock('./use_libraries', () => ({useSharedLibraries: () => ({libraries: null, items: []})}));

const mocked = client as jest.Mocked<typeof client>;
const tools = jest.requireMock('../excalidraw/tools') as {importScene: jest.Mock};

const townSquare = {id: 'c1', type: 'O', display_name: 'Town Square', name: 'town-square', delete_at: 0} as Channel;

const board: Doc = {
    id: 'b1',
    title: 'Roadmap',
    channel_id: 'c1',
    creator_id: 'me',
    create_at: 1,
    update_at: Date.now(),
    can_edit: true,
    can_delete: true,
};

function store() {
    const state = {
        entities: {
            general: {config: {}, license: {}},
            preferences: {myPreferences: {}},
            users: {currentUserId: 'me', profiles: {me: {id: 'me', username: 'maya'}}, statuses: {}, profilesInChannel: {}},
            channels: {currentChannelId: 'c1', channels: {c1: townSquare}, myMembers: {}},
            teams: {currentTeamId: 't1', teams: {t1: {id: 't1', name: 'lumen'}}},
        },
    };
    return createStore(() => state);
}

const wrap = (node: React.ReactNode) => (
    <Provider store={store()}>
        <IntlProvider locale='en'>{node}</IntlProvider>
    </Provider>
);

function renderPanel(initialPanelState?: string) {
    return render(wrap(<BoardsPanel {...(initialPanelState ? {initialPanelState} : {})}/>));
}

const setWebUI = (ui?: 'classic' | 'fusion') => {
    window.antimatterWebUI = ui;
    if (ui) {
        document.documentElement.dataset.amWebUi = ui;
    } else {
        delete document.documentElement.dataset.amWebUi;
    }
};

// Opens the board's menu and picks an item
function pick(item: string) {
    fireEvent.click(screen.getByRole('button', {name: 'Board actions'}));
    fireEvent.click(screen.getByRole('menuitem', {name: item}));
}

let confirmSpy: jest.SpyInstance;

beforeEach(() => {
    jest.clearAllMocks();
    setOpenDoc(null);
    setListView('channel');
    mocked.listDocs.mockResolvedValue([]);
    mocked.listFavorites.mockResolvedValue([]);
    mocked.getDoc.mockResolvedValue(board);
    mocked.deleteDoc.mockResolvedValue({} as never);
    const layer = document.createElement('div');
    layer.id = FUSION_LAYER_ID;
    layer.className = 'am-layer';
    document.body.appendChild(layer);
    confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
    document.getElementById(FUSION_LAYER_ID)?.remove();
    confirmSpy.mockRestore();
    setWebUI(undefined);
});

describe('under the Fusion UI', () => {
    beforeEach(() => setWebUI('fusion'));

    test('deleting a board asks with Fusion\'s dialog, and deletes only on yes', async () => {
        renderPanel('board/b1');
        await screen.findByRole('textbox', {name: 'Title'});

        pick('Delete');
        let dialog = await screen.findByRole('alertdialog', {name: 'Delete "Roadmap"?'});
        expect(document.getElementById(FUSION_LAYER_ID)!.contains(dialog)).toBe(true);
        expect(within(dialog).getByText('It\'s deleted for everyone. This can\'t be undone.')).toBeInTheDocument();
        expect(within(dialog).getByRole('button', {name: 'Delete'})).toHaveClass('am-btn', 'am-danger');
        fireEvent.click(within(dialog).getByRole('button', {name: 'Cancel'}));
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(mocked.deleteDoc).not.toHaveBeenCalled();

        pick('Delete');
        dialog = await screen.findByRole('alertdialog', {name: 'Delete "Roadmap"?'});
        await act(async () => {
            fireEvent.click(within(dialog).getByRole('button', {name: 'Delete'}));
        });
        await waitFor(() => expect(mocked.deleteDoc).toHaveBeenCalledWith('b1'));
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    test('importing a file over a board asks with Fusion\'s dialog, and imports only on yes', async () => {
        const {container} = renderPanel('board/b1');
        await screen.findByTestId('canvas');
        const input = container.querySelector<HTMLInputElement>('.am-wb-bar input[type="file"]')!;
        const file = new File(['{}'], 'plan.excalidraw', {type: 'application/json'});

        fireEvent.change(input, {target: {files: [file]}});
        let dialog = await screen.findByRole('alertdialog', {name: 'Replace the content of "Roadmap"?'});
        expect(within(dialog).getByText('What\'s drawn on it is replaced by plan.excalidraw, for everyone.')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', {name: 'Cancel'}));
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(tools.importScene).not.toHaveBeenCalled();

        fireEvent.change(input, {target: {files: [file]}});
        dialog = await screen.findByRole('alertdialog', {name: 'Replace the content of "Roadmap"?'});
        await act(async () => {
            fireEvent.click(within(dialog).getByRole('button', {name: 'Replace'}));
        });
        await waitFor(() => expect(tools.importScene).toHaveBeenCalledWith({fake: 'api'}, file));
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    test('deleting a library asks with Fusion\'s dialog, and deletes only on yes', async () => {
        mocked.listLibraries.mockResolvedValue({
            team_id: 't1',
            can_manage_team: true,
            can_manage_server: false,
            libraries: [{id: 'l1', name: 'Flow charts', team_id: 't1', item_count: 1, size: 10, creator_id: 'me', create_at: 1, update_at: 1}],
        } as never);
        mocked.deleteLibrary.mockResolvedValue({} as never);
        render(wrap(<LibraryManager where={{teamId: 't1'}}/>));
        await screen.findByText('Flow charts');

        fireEvent.click(screen.getByRole('button', {name: 'Delete'}));
        let dialog = await screen.findByRole('alertdialog', {name: 'Delete the library "Flow charts"?'});
        fireEvent.click(within(dialog).getByRole('button', {name: 'Cancel'}));
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(mocked.deleteLibrary).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', {name: 'Delete'}));
        dialog = await screen.findByRole('alertdialog', {name: 'Delete the library "Flow charts"?'});
        await act(async () => {
            fireEvent.click(within(dialog).getByRole('button', {name: 'Delete'}));
        });
        await waitFor(() => expect(mocked.deleteLibrary).toHaveBeenCalledWith('l1'));
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    test('tooltips are Fusion\'s (data-am-tip), and nothing keeps a browser tooltip', async () => {
        const {container} = renderPanel('board/b1');
        await screen.findByTestId('canvas');
        const back = screen.getByRole('button', {name: 'All boards'});
        expect(back).toHaveAttribute('data-am-tip', 'All boards');
        expect(screen.getByRole('button', {name: 'Board actions'})).toHaveAttribute('data-am-tip', 'Board actions');
        expect(screen.getByRole('button', {name: 'Add to favourites'})).toHaveAttribute('data-am-tip', 'Add to favourites');
        expect(container.querySelector('.am-wb-scope')).toHaveAttribute('data-am-tip', 'Shared with everyone in ~Town Square');
        expect(container.querySelectorAll('[title]')).toHaveLength(0);

        fireEvent.click(back);
        const create = await screen.findByRole('button', {name: 'New board in this channel'});
        expect(create).toHaveAttribute('data-am-tip', 'New board in this channel');
        expect(container.querySelectorAll('[title]')).toHaveLength(0);
    });

    test('an empty list is Fusion\'s empty state, with the one thing to do: a new board', async () => {
        mocked.createDoc.mockResolvedValue({...board, id: 'b2'});
        renderPanel();
        const empty = await screen.findByText('No boards here yet. Every member of the channel can draw on the boards added here.');
        const state = empty.closest('[data-empty-state]')!;
        expect(state).toHaveClass('am-empty', 'amfx-empty');
        expect(state.querySelector('.amfx-empty-ic [class*="am-ic"]')).not.toBeNull();
        const action = within(state as HTMLElement).getByRole('button', {name: 'New board in this channel'});
        expect(action).toHaveClass('am-btn', 'am-primary');
        await act(async () => {
            fireEvent.click(action);
        });
        expect(mocked.createDoc).toHaveBeenCalledWith('', 'c1');
    });

    test('while loading, a quiet line says what loads, never a lone ellipsis', async () => {
        mocked.listDocs.mockReturnValue(new Promise(() => null));
        renderPanel();
        const busy = await screen.findByRole('status');
        expect(busy).toHaveClass('am-empty', 'amfx-empty', 'amfx-busy');
        expect(busy).toHaveTextContent('Loading the boards…');
        expect(screen.queryByText('…')).toBeNull();
    });

    test('a board that can\'t be opened is a Fusion empty state in the danger tone', async () => {
        mocked.getDoc.mockRejectedValue(Object.assign(new Error('Forbidden'), {status: 404}));
        renderPanel('board/b1');
        const failure = await screen.findByTestId('board-failure');
        expect(failure).toHaveClass('am-empty', 'amfx-empty', 'amfx-danger');
        expect(failure).toHaveTextContent('This board was deleted, or you can\'t open it.');
    });

    test('the panel and the cards of shared boards carry the app\'s colour (--am-cc)', async () => {
        const {container} = renderPanel();
        await screen.findByRole('tab', {name: 'This channel'});
        expect(container.querySelector<HTMLElement>('.am-wb-root')!.style.getPropertyValue('--am-cc')).toBe('#FB923C');

        const post = {id: 'p1', props: {doc_id: 'b1', title: 'Roadmap'}} as unknown as Post;
        const card = render(wrap(<BoardPost post={post}/>));
        await card.findByText('Roadmap');
        const el = card.container.querySelector<HTMLElement>('.am-card')!;
        expect(el).toHaveClass('am-wb-card');
        expect(el.style.getPropertyValue('--am-cc')).toBe('#FB923C');
    });
});

describe('under the classic UI', () => {
    beforeEach(() => setWebUI('classic'));

    test('deleting a board keeps the browser\'s confirmation', async () => {
        renderPanel('board/b1');
        await screen.findByRole('textbox', {name: 'Title'});
        pick('Delete');
        await waitFor(() => expect(mocked.deleteDoc).toHaveBeenCalledWith('b1'));
        expect(confirmSpy).toHaveBeenCalledWith('Delete "Roadmap"?\n\nIt\'s deleted for everyone. This can\'t be undone.');
        expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    test('tooltips stay the browser\'s (title), and the empty list keeps its line, with no Fusion classes', async () => {
        const {container} = renderPanel();
        const create = await screen.findByRole('button', {name: 'New board in this channel'});
        expect(create).toHaveAttribute('title', 'New board in this channel');
        expect(create).not.toHaveAttribute('data-am-tip');

        const empty = await screen.findByText('No boards here yet. Every member of the channel can draw on the boards added here.');
        const state = empty.closest('[data-empty-state]')!;
        expect(state.className).toBe('amw-wb-empty');
        expect(state.querySelector('button')).toBeNull();
        expect(container.querySelector('.amfx-empty, .am-empty')).toBeNull();
    });
});
