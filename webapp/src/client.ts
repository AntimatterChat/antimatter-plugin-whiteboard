// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {Post} from '@mattermost/types/posts';

import {Client4} from 'mattermost-redux/client';

import type {BoardAPI, BoardFile} from './board_session';
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
}

export const client = new BoardClient(manifest.id);
export const events = new RelayEventBus();
