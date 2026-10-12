// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React from 'react';

import LibraryManager from './library_manager';

// AdminLibraries is the Libraries setting of the plugin in the System Console: the server-wide
// libraries, which every community gets.
export default function AdminLibraries() {
    return (
        <div className='amw-wb-admin'>
            <LibraryManager
                where={{}}
                admin={true}
            />
        </div>
    );
}
