// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {createContext, useContext} from 'react';
import {FormattedMessage} from 'react-intl';

// What the library panel of a board offers in place of Excalidraw's "Browse libraries" (which
// opens libraries.excalidraw.com): the admins manage the libraries of the community, the others
// are told to ask them.
export type LibraryNoteState = {
    canManage: boolean;
    onManage: () => void;
};

export const LibraryNoteContext = createContext<LibraryNoteState | null>(null);

export function LibraryNote() {
    const state = useContext(LibraryNoteContext);
    if (!state) {
        return null;
    }
    if (state.canManage) {
        return (
            <button
                type='button'
                className='library-menu-browse-button wb-library-manage'
                onClick={state.onManage}
            >
                <FormattedMessage
                    id='whiteboard.libraries.manage'
                    defaultMessage='Manage libraries'
                />
            </button>
        );
    }
    return (
        <span className='wb-library-note'>
            <FormattedMessage
                id='whiteboard.libraries.ask'
                defaultMessage='Ask an admin to add libraries.'
            />
        </span>
    );
}

declare global {
    interface Window {

        // Rendered by Excalidraw's library in place of its "Browse libraries" button (excalidraw_offline_loader.js)
        AntimatterWhiteboardLibraryButton?: () => React.ReactNode;
    }
}

export function installLibraryNote() {
    window.AntimatterWhiteboardLibraryButton = () => <LibraryNote/>;
}
