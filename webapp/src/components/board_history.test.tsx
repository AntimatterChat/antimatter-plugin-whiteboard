// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {fireEvent, render, screen} from '@testing-library/react';
import React from 'react';
import {IntlProvider} from 'react-intl';

import {client} from '../client';
import {encodeScene} from '../scene';

import BoardHistory, {loadVersion} from './board_history';

jest.mock('../excalidraw/tools', () => ({versionSVG: async () => '<svg></svg>'}));
jest.mock('../client', () => ({
    client: {getVersions: jest.fn(), getVersion: jest.fn(), getFile: jest.fn()},
}));

const mocked = client as unknown as {getVersions: jest.Mock; getVersion: jest.Mock; getFile: jest.Mock};

const elements = [
    {id: 'a', version: 2, versionNonce: 1, type: 'rectangle'},
    {id: 'b', version: 3, versionNonce: 1, type: 'image', fileId: 'f1'},
    {id: 'c', version: 4, versionNonce: 1, type: 'image', fileId: 'f2', isDeleted: true},
];

function fileOf(_doc: string, id: string) {
    return Promise.resolve({id, mimeType: 'image/png', dataURL: 'data:', created: 1});
}

beforeEach(() => {
    mocked.getVersions.mockResolvedValue([{seq: 10, at: Date.UTC(2026, 9, 1, 9)}, {seq: 20, at: Date.UTC(2026, 9, 1, 10)}]);
    mocked.getVersion.mockResolvedValue(encodeScene(elements));
    mocked.getFile.mockImplementation(fileOf);
    URL.createObjectURL = jest.fn().mockReturnValue('blob:preview');
    URL.revokeObjectURL = jest.fn();
});

test('versions are read with their images, without the deleted elements', async () => {
    const version = await loadVersion('doc', 10);
    expect(version.elements.map((e) => e.id)).toEqual(['a', 'b']);
    expect(version.files.map((f) => f.id)).toEqual(['f1']);
    expect(mocked.getFile).toHaveBeenCalledTimes(1);
});

test('versions are listed newest first, previewed and restored', async () => {
    const onRestore = jest.fn();
    const {container} = render(
        <IntlProvider
            locale='en'
            timeZone='UTC'
        >
            <BoardHistory
                docId='doc'
                dark={false}
                canRestore={true}
                onRestore={onRestore}
            />
        </IntlProvider>,
    );
    const buttons = await screen.findAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Oct 1 10:00 AM', 'Oct 1 9:00 AM']);

    fireEvent.click(buttons[1]);
    await screen.findByText('Restore this version');
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:preview');
    expect(mocked.getVersion).toHaveBeenCalledWith('doc', 10);

    fireEvent.click(screen.getByText('Restore this version'));
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({files: [expect.objectContaining({id: 'f1'})]}));
});
