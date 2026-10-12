// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {fireEvent, render, screen} from '@testing-library/react';
import React from 'react';
import {IntlProvider} from 'react-intl';

import {installLibraryNote, LibraryNoteContext, type LibraryNoteState} from './library_note';

function renderNote(state: LibraryNoteState | null) {
    installLibraryNote();
    return render(
        <IntlProvider locale='en'>
            <LibraryNoteContext.Provider value={state}>
                <div>{window.AntimatterWhiteboardLibraryButton?.()}</div>
            </LibraryNoteContext.Provider>
        </IntlProvider>,
    );
}

test('members are told to ask an admin', () => {
    renderNote({canManage: false, onManage: jest.fn()});
    expect(screen.getByText('Ask an admin to add libraries.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('a')).toBeNull();
});

test('admins manage the libraries', () => {
    const onManage = jest.fn();
    renderNote({canManage: true, onManage});
    fireEvent.click(screen.getByRole('button', {name: 'Manage libraries'}));
    expect(onManage).toHaveBeenCalled();
});

test('nothing outside a board', () => {
    const {container} = renderNote(null);
    expect(container.textContent).toBe('');
});
