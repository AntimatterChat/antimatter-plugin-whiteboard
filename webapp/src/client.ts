// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {Post} from '@mattermost/types/posts';

import {Client4} from 'mattermost-redux/client';

import type {BoardAPI, BoardFile} from './board_session';
import type {Libraries, Library, LibraryItem} from './libraries';
import manifest from './manifest';
import {RelayClient, RelayError} from './relay/client';
import {RelayEventBus} from './relay/events';

// BoardClient is the whiteboard API of the server: the relay API, the images and the thumbnails
// of the boards.
class BoardClient extends RelayClient implements BoardAPI {
    getFile(docId: string, fileId: string) {
        return this.request<BoardFile>('GET', `/docs/${docId}/files/${encodeURIComponent(fileId)}`);
    }

    putFile(docId: string, file: BoardFile) {
        return this.request<unknown>('PUT', `/docs/${docId}/files/${encodeURIComponent(file.id)}`, file);
    }

    async putThumbnail(docId: string, png: Blob) {
        const options = Client4.getOptions({method: 'PUT', headers: {'Content-Type': 'image/png'}});
        const response = await fetch(this.url(`/docs/${docId}/thumbnail`), {...options, body: png} as RequestInit);
        if (!response.ok) {
            throw new RelayError(response.statusText, response.status);
        }
    }

    thumbnailURL(docId: string, version?: number) {
        return this.url(`/docs/${docId}/thumbnail`) + (version ? `?v=${version}` : '');
    }

    share(docId: string) {
        return this.request<Post>('POST', `/docs/${docId}/share`, {});
    }

    // listLibraries gives the libraries of the server, and of a community: the team of the channel, or the team
    // given for the channels without one and the personal boards.
    listLibraries({channelId, teamId}: {channelId?: string; teamId?: string}) {
        const query = new URLSearchParams();
        if (channelId) {
            query.set('channel_id', channelId);
        }
        if (teamId) {
            query.set('team_id', teamId);
        }
        const q = query.toString();
        return this.request<Libraries>('GET', '/libraries' + (q ? '?' + q : ''));
    }

    async getLibraryItems(libraryId: string) {
        const file = await this.request<{libraryItems: LibraryItem[]}>('GET', `/libraries/${libraryId}/items`);
        return file.libraryItems || [];
    }

    // uploadLibrary adds an .excalidrawlib file as a library of a community (or of the server, without teamId).
    async uploadLibrary(file: File, name: string, teamId = '') {
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('name', name);
        if (teamId) {
            form.append('team_id', teamId);
        }
        const response = await fetch(this.url('/libraries'), {...Client4.getOptions({method: 'POST'}), body: form} as RequestInit);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new RelayError(data.error || response.statusText, response.status);
        }
        return data as {library: Library; skipped_items: number};
    }

    renameLibrary(libraryId: string, name: string) {
        return this.request<Library>('PATCH', `/libraries/${libraryId}`, {name});
    }

    deleteLibrary(libraryId: string) {
        return this.request<unknown>('DELETE', `/libraries/${libraryId}`);
    }
}

export const client = new BoardClient(manifest.id);
export const events = new RelayEventBus();
