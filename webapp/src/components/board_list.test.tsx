// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {act, fireEvent, render, screen, within} from '@testing-library/react';
import React from 'react';
import {IntlProvider} from 'react-intl';
import {Provider} from 'react-redux';
import {legacy_createStore as createStore} from 'redux';

import type {Channel} from '@mattermost/types/channels';

import {client} from '../client';
import type {Doc} from '../relay/client';
import {setListView, setOpenDoc} from '../ui_state';

import BoardList from './board_list';

// The list's layout, the same in Notes, Todo and Whiteboard: the tabs, then the view's header row (what the view is
// on the left, the + making a board there on the right), then its boards or its empty state.

jest.mock('mattermost-redux/client', () => ({Client4: {getProfilePictureUrl: () => '', getProfilesByIds: jest.fn(() => Promise.resolve([]))}}));

jest.mock('../client', () => ({
    client: {
        listDocs: jest.fn(),
        listFavorites: jest.fn(),
        createDoc: jest.fn(),
    },
    events: {addDoc: () => () => null, addListListener: () => () => null},
}));

const mocked = client as jest.Mocked<typeof client>;

const townSquare = {id: 'c1', type: 'O', display_name: 'Town Square', name: 'town-square', delete_at: 0} as Channel;
const dm = {id: 'd1', type: 'D', display_name: 'bob', name: 'me__bob', delete_at: 0} as Channel;

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

const setWebUI = (ui?: 'classic' | 'fusion') => {
    window.antimatterWebUI = ui;
    if (ui) {
        document.documentElement.dataset.amWebUi = ui;
    } else {
        delete document.documentElement.dataset.amWebUi;
    }
};

function renderList(channel: Channel = townSquare) {
    const state = {
        entities: {
            general: {config: {}, license: {}},
            preferences: {myPreferences: {}},
            users: {currentUserId: 'me', profiles: {me: {id: 'me', username: 'maya'}}, statuses: {}, profilesInChannel: {}},
            channels: {currentChannelId: channel.id, channels: {[channel.id]: channel}, myMembers: {}},
            teams: {currentTeamId: 't1', teams: {t1: {id: 't1', name: 'lumen'}}},
        },
    };
    render(
        <Provider store={createStore(() => state)}>
            <IntlProvider locale='en'>
                <BoardList channel={channel}/>
            </IntlProvider>
        </Provider>,
    );
}

// The view's header row, and what it holds
const head = () => screen.getByTestId('boards-section-head');
const headButtons = () => within(head()).queryAllByRole('button');
const pickTab = (name: string) => fireEvent.click(screen.getByRole('tab', {name}));

beforeEach(() => {
    jest.clearAllMocks();
    setOpenDoc(null);
    setListView('channel');
    mocked.listDocs.mockResolvedValue([]);
    mocked.listFavorites.mockResolvedValue([]);
    mocked.createDoc.mockResolvedValue({...board, id: 'b2'});
});

afterEach(() => setWebUI(undefined));

describe.each(['fusion', 'classic'] as const)('under the %s UI', (ui) => {
    beforeEach(() => setWebUI(ui));

    test('the header row sits right under the tabs: "Shared with" the channel, and its + on the right', async () => {
        mocked.listDocs.mockImplementation((channelId?: string) => Promise.resolve(channelId ? [board] : []));
        renderList();

        expect(await screen.findByText('Roadmap')).toBeInTheDocument();
        expect(head().previousElementSibling).toBe(screen.getByRole('tablist'));
        expect(head()).toHaveTextContent('Shared with Town Square');
        expect(headButtons()).toHaveLength(1);
        const add = within(head()).getByRole('button', {name: 'New board in this channel'});
        expect(add.previousElementSibling).toHaveTextContent('Shared with Town Square');

        await act(async () => {
            fireEvent.click(add);
        });
        expect(mocked.createDoc).toHaveBeenCalledWith('', 'c1');
    });

    test('in a direct message, the boards are shared with "this conversation"', async () => {
        renderList(dm);
        expect(await screen.findByText('Every member of the conversation can draw on the boards added here.')).toBeInTheDocument();
        expect(head()).toHaveTextContent('Shared with this conversation');
        expect(within(head()).getByRole('button', {name: 'New board in this conversation'})).toBeInTheDocument();
    });

    test('the favourites have a header row without a +', async () => {
        renderList();
        pickTab('Favourites');
        expect(await screen.findByText('Nothing starred yet')).toBeInTheDocument();
        expect(head()).toHaveTextContent('Favourites');
        expect(headButtons()).toHaveLength(0);
        expect(screen.queryByRole('button', {name: /New/})).toBeNull();
    });

    test('an archived channel has its header row, without a +', async () => {
        renderList({...townSquare, delete_at: 5});
        expect(await screen.findByText('No boards here yet')).toBeInTheDocument();
        expect(head()).toHaveTextContent('Shared with Town Square');
        expect(headButtons()).toHaveLength(0);
        expect(screen.queryByRole('button', {name: /New/})).toBeNull();
    });

    test('mine: "Personal boards", and its + makes a personal board', async () => {
        renderList();
        pickTab('Mine');
        expect(await screen.findByText('No personal boards yet')).toBeInTheDocument();
        expect(head()).toHaveTextContent('Personal boards');
        await act(async () => {
            fireEvent.click(within(head()).getByRole('button', {name: 'New personal board'}));
        });
        expect(mocked.createDoc).toHaveBeenCalledWith('', '');
    });
});

describe('empty views', () => {
    test('under Fusion: an icon, a title, a sentence and the + as their action, where one can make a board', async () => {
        setWebUI('fusion');
        renderList();
        const empty = (await screen.findByText('No boards here yet')).closest('[data-empty-state]') as HTMLElement;
        expect(empty).toHaveClass('am-empty', 'amfx-empty');
        expect(empty.querySelector('.amfx-empty-ic')).not.toBeNull();
        expect(within(empty).getByText('Every member of the channel can draw on the boards added here.')).toBeInTheDocument();
        expect(within(empty).getByRole('button', {name: 'New board in this channel'})).toHaveClass('am-btn', 'am-primary');

        pickTab('Favourites');
        const starred = (await screen.findByText('Nothing starred yet')).closest('[data-empty-state]') as HTMLElement;
        expect(within(starred).getByText('Star a board to find it here, wherever it is.')).toBeInTheDocument();
        expect(within(starred).queryByRole('button')).toBeNull();
    });

    test('an archived channel offers no action', async () => {
        setWebUI('fusion');
        renderList({...townSquare, delete_at: 5});
        const empty = (await screen.findByText('No boards here yet')).closest('[data-empty-state]') as HTMLElement;
        expect(within(empty).queryByRole('button')).toBeNull();
    });

    test('the classic UI: its own empty state, a title and a sentence, the + only in the header row', async () => {
        setWebUI('classic');
        renderList();
        const empty = (await screen.findByText('No boards here yet')).closest('[data-empty-state]') as HTMLElement;
        expect(empty.className).toBe('amw-wb-empty');
        expect(within(empty).getByText('Every member of the channel can draw on the boards added here.')).toBeInTheDocument();
        expect(within(empty).queryByRole('button')).toBeNull();
        expect(screen.getAllByRole('button', {name: 'New board in this channel'})).toHaveLength(1);
    });
});
