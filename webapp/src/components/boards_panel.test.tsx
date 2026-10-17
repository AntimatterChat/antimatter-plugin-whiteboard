// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {act, fireEvent, render, screen} from '@testing-library/react';
import React from 'react';
import {IntlProvider} from 'react-intl';
import {Provider} from 'react-redux';
import {legacy_createStore as createStore} from 'redux';

import type {Channel} from '@mattermost/types/channels';

import {client} from '../client';
import type {Doc} from '../relay/client';
import {setListView, setOpenDoc} from '../ui_state';

import BoardsPanel from './boards_panel';

// Where the panel is (the host's setPanelState and initialPanelState props), in the window it's in and in the one it
// was popped out into.

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
    },
    events: {addDoc: () => () => null, addListListener: () => () => null},
}));

// The session of an open board, still loading: the canvas (Excalidraw) isn't drawn
jest.mock('../board_session', () => ({
    __esModule: true,
    default: class {
        status = 'loading';
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
jest.mock('../excalidraw/canvas', () => ({__esModule: true, default: () => null}));
jest.mock('../excalidraw/tools', () => ({}));
jest.mock('./use_libraries', () => ({useSharedLibraries: () => ({libraries: null, items: []})}));

const mocked = client as jest.Mocked<typeof client>;

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

// renderApp renders the panel with the props Fusion gives it.
function renderApp(props: {initialPanelState?: string} = {}) {
    const setPanelState = jest.fn();
    render(
        <Provider store={store()}>
            <IntlProvider locale='en'>
                <BoardsPanel
                    {...props}
                    setPanelState={setPanelState}
                />
            </IntlProvider>
        </Provider>,
    );
    return setPanelState;
}

// A board opened from its card in the channel, as the cards do
const openFromCard = (docId: string) => act(() => setOpenDoc(docId));

beforeEach(() => {
    jest.clearAllMocks();
    setOpenDoc(null);
    setListView('channel');
    mocked.listDocs.mockResolvedValue([]);
    mocked.listFavorites.mockResolvedValue([]);
    mocked.getDoc.mockResolvedValue(board);
});

describe('in the window it was popped out into', () => {
    test('the panel starts at the board it showed, fetched again', async () => {
        const setPanelState = renderApp({initialPanelState: 'board/b1'});

        expect(await screen.findByRole('textbox', {name: 'Title'})).toHaveValue('Roadmap');
        expect(mocked.getDoc).toHaveBeenCalledWith('b1');

        // It says it's there from the start, never on its list first
        expect(setPanelState).toHaveBeenCalledWith('board/b1');
        expect(setPanelState).not.toHaveBeenCalledWith(null);
        expect(mocked.listDocs).not.toHaveBeenCalled();

        // Back to the list: the state follows
        fireEvent.click(screen.getByRole('button', {name: 'All boards'}));
        expect(await screen.findByRole('tab', {name: 'This channel'})).toHaveAttribute('aria-selected', 'true');
        expect(setPanelState).toHaveBeenLastCalledWith(null);
    });

    test('the panel starts on the list it showed', async () => {
        const setPanelState = renderApp({initialPanelState: 'list/favorites'});

        expect(await screen.findByRole('tab', {name: 'Favourites'})).toHaveAttribute('aria-selected', 'true');
        expect(mocked.listFavorites).toHaveBeenCalled();
        expect(setPanelState).toHaveBeenLastCalledWith('list/favorites');
    });

    test("a board the person can't open any more shows its not-found view, and the way back to the list", async () => {
        mocked.getDoc.mockRejectedValue(Object.assign(new Error('Forbidden'), {status: 404}));
        const setPanelState = renderApp({initialPanelState: 'board/b1'});

        expect(await screen.findByText("This board was deleted, or you can't open it.")).toBeInTheDocument();
        expect(screen.queryByRole('textbox', {name: 'Title'})).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: 'All boards'}));
        expect(await screen.findByRole('tab', {name: 'This channel'})).toBeInTheDocument();
        expect(setPanelState).toHaveBeenLastCalledWith(null);
    });

    test("a state the app didn't write opens its list, and fetches nothing it names", async () => {
        const setPanelState = renderApp({initialPanelState: 'board/../admin'});

        expect(await screen.findByRole('tab', {name: 'This channel'})).toHaveAttribute('aria-selected', 'true');
        expect(mocked.getDoc).not.toHaveBeenCalled();
        expect(setPanelState).toHaveBeenLastCalledWith(null);
    });
});

describe('in the main window', () => {
    test('the panel says where it is as it moves', async () => {
        const setPanelState = renderApp();
        expect(setPanelState).toHaveBeenLastCalledWith(null);

        fireEvent.click(await screen.findByRole('tab', {name: 'Mine'}));
        expect(setPanelState).toHaveBeenLastCalledWith('list/mine');

        openFromCard('b1');
        expect(await screen.findByRole('textbox', {name: 'Title'})).toBeInTheDocument();
        expect(setPanelState).toHaveBeenLastCalledWith('board/b1');
    });

    test('without the host props (the classic UI), it opens on its list as before', async () => {
        render(
            <Provider store={store()}>
                <IntlProvider locale='en'>
                    <BoardsPanel/>
                </IntlProvider>
            </Provider>,
        );
        expect(await screen.findByRole('tab', {name: 'This channel'})).toHaveAttribute('aria-selected', 'true');
    });
});
