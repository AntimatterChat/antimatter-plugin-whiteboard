// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import React from 'react';
import {IntlProvider} from 'react-intl';

import {client} from '../client';
import type {Libraries, Library} from '../libraries';

import LibraryManager, {libraryFileName} from './library_manager';

jest.mock('../client', () => ({
    client: {listLibraries: jest.fn(), uploadLibrary: jest.fn(), renameLibrary: jest.fn(), deleteLibrary: jest.fn()},
}));

const mocked = client as unknown as Record<'listLibraries' | 'uploadLibrary' | 'renameLibrary' | 'deleteLibrary', jest.Mock>;

const lib = (id: string, name: string, teamId: string, count = 3): Library => ({id, name, team_id: teamId, item_count: count, size: 2048, creator_id: 'u', create_at: 1, update_at: 1});

function libraries(over: Partial<Libraries> = {}): Libraries {
    return {
        team_id: 'team1',
        can_manage_team: true,
        can_manage_server: false,
        libraries: [lib('s1', 'Basics', ''), lib('t1', 'Flow charts', 'team1', 1)],
        ...over,
    };
}

function renderManager(props: Partial<React.ComponentProps<typeof LibraryManager>> = {}) {
    return render(
        <IntlProvider locale='en'>
            <LibraryManager
                where={{channelId: 'chan', teamId: 'team1'}}
                {...props}
            />
        </IntlProvider>,
    );
}

const sections = () => Array.from(document.querySelectorAll('section'));

beforeEach(() => {
    jest.resetAllMocks();
    mocked.listLibraries.mockResolvedValue(libraries());
});

test('names libraries after their files', () => {
    expect(libraryFileName('Flow charts.excalidrawlib')).toBe('Flow charts');
    expect(libraryFileName('icons.JSON')).toBe('icons');
});

test('lists the community\'s libraries and the server\'s; team admins manage their community\'s only', async () => {
    renderManager();
    expect(await screen.findByText('Flow charts')).toBeInTheDocument();
    expect(mocked.listLibraries).toHaveBeenCalledWith({channelId: 'chan', teamId: 'team1'});

    const [team, server] = sections();
    expect(within(team).getByText('This community')).toBeInTheDocument();
    expect(within(team).getByText('1 shape · 2 KB')).toBeInTheDocument();
    expect(within(team).getByRole('button', {name: 'Delete'})).toBeInTheDocument();
    expect(within(team).getByRole('button', {name: 'Add a library (.excalidrawlib)'})).toBeInTheDocument();

    expect(within(server).getByText('Basics')).toBeInTheDocument();
    expect(within(server).queryByRole('button', {name: 'Delete'})).toBeNull();
    expect(within(server).queryByRole('button', {name: 'Add a library (.excalidrawlib)'})).toBeNull();
});

test('uploads an .excalidrawlib file to the community', async () => {
    mocked.uploadLibrary.mockResolvedValue({library: lib('t2', 'Icons', 'team1', 12), skipped_items: 2});
    renderManager();
    await screen.findByText('Flow charts');

    const file = new File(['{}'], 'Icons.excalidrawlib', {type: 'application/json'});
    await act(async () => {
        fireEvent.change(screen.getByTestId('library-file-team1'), {target: {files: [file]}});
    });
    expect(mocked.uploadLibrary).toHaveBeenCalledWith(file, 'Icons', 'team1');
    expect(await screen.findByText('Added "Icons": 12 shapes. 2 shapes with images or web pages were left out.')).toBeInTheDocument();
    expect(mocked.listLibraries).toHaveBeenCalledTimes(2);
});

test('tells why an upload failed', async () => {
    mocked.uploadLibrary.mockRejectedValue(new Error('this is not an Excalidraw library (.excalidrawlib) file'));
    renderManager();
    await screen.findByText('Flow charts');
    await act(async () => {
        fireEvent.change(screen.getByTestId('library-file-team1'), {target: {files: [new File(['x'], 'x.excalidrawlib')]}});
    });
    expect(await screen.findByText('this is not an Excalidraw library (.excalidrawlib) file')).toBeInTheDocument();
});

test('renames and deletes', async () => {
    mocked.renameLibrary.mockResolvedValue(lib('t1', 'Diagrams', 'team1'));
    mocked.deleteLibrary.mockResolvedValue({});
    window.confirm = jest.fn().mockReturnValue(true);
    renderManager();
    await screen.findByText('Flow charts');
    const [team] = sections();

    fireEvent.click(within(team).getByRole('button', {name: 'Rename'}));
    const input = within(team).getByRole('textbox', {name: 'Name of the library'});
    fireEvent.change(input, {target: {value: 'Diagrams'}});
    await act(async () => {
        fireEvent.keyDown(input, {key: 'Enter'});
    });
    expect(mocked.renameLibrary).toHaveBeenCalledTimes(1);
    expect(mocked.renameLibrary).toHaveBeenCalledWith('t1', 'Diagrams');

    await act(async () => {
        fireEvent.click(within(team).getByRole('button', {name: 'Delete'}));
    });
    // Under the classic UI, still the browser's confirmation
    expect(window.confirm).toHaveBeenCalledWith('Delete the library "Flow charts"?\n\nIts shapes leave the library of every board.');
    await waitFor(() => expect(mocked.deleteLibrary).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(mocked.listLibraries).toHaveBeenCalledTimes(3));
});

test('members see the libraries without managing them', async () => {
    mocked.listLibraries.mockResolvedValue(libraries({can_manage_team: false}));
    renderManager();
    await screen.findByText('Flow charts');
    expect(screen.queryByRole('button', {name: 'Delete'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'Add a library (.excalidrawlib)'})).toBeNull();
});

test('in the System Console, the server\'s libraries, with the classic markup', async () => {
    mocked.listLibraries.mockResolvedValue(libraries({team_id: '', can_manage_team: false, can_manage_server: true, libraries: [lib('s1', 'Basics', '')]}));
    renderManager({where: {}, admin: true});
    expect(await screen.findByText('Basics')).toBeInTheDocument();
    expect(mocked.listLibraries).toHaveBeenCalledWith({});
    expect(sections()).toHaveLength(1);
    expect(screen.getByText('Libraries for every community')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Delete'})).toBeInTheDocument();
    expect(document.querySelector('.amw-wb-libs')).not.toBeNull();
});
