// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {render, screen} from '@testing-library/react';
import React from 'react';
import {IntlProvider} from 'react-intl';

import type {SyncStatus} from '../relay/connection';

import StatusText from './status_text';

function renderStatus(status: SyncStatus, full: boolean, editable = true) {
    render(
        <IntlProvider locale='en'>
            <StatusText
                session={{status, full}}
                editable={editable}
            />
        </IntlProvider>,
    );
}

describe('StatusText', () => {
    test('says the board is full, in place of "Saved"', () => {
        renderStatus('saved', true);
        expect(screen.getByText("Board full: new drawings aren't saved")).toBeInTheDocument();
        expect(screen.queryByText('Saved')).toBeNull();
    });

    test('shows "Saved" when the board has room', () => {
        renderStatus('saved', false);
        expect(screen.getByText('Saved')).toBeInTheDocument();
    });

    test('offline and read only come first', () => {
        renderStatus('offline', true);
        expect(screen.getByText('Offline')).toBeInTheDocument();
    });

    test('a viewer who can\'t edit sees read only', () => {
        renderStatus('saved', true, false);
        expect(screen.getByText('Read only')).toBeInTheDocument();
    });
});
