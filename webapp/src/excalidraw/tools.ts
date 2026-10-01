// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

// The parts of Excalidraw (MIT) used outside its component: reconciling elements, exports and
// imports. This module is loaded with Excalidraw, on demand.

import {
    CaptureUpdateAction,
    exportToBlob,
    exportToSvg,
    getNonDeletedElements,
    loadFromBlob,
    reconcileElements,
    restoreElements,
    serializeAsJSON,
} from '@excalidraw/excalidraw';
import type {ExcalidrawElement, OrderedExcalidrawElement} from '@excalidraw/excalidraw/element/types';
import type {AppState, BinaryFileData, BinaryFiles, ExcalidrawImperativeAPI} from '@excalidraw/excalidraw/types';

import type {BoardFile, CanvasTools} from '../board_session';
import {replacementScene, type SceneElement} from '../scene';

type Remote = Parameters<typeof reconcileElements>[1];

// The largest side of the thumbnails of the boards, in pixels.
const THUMBNAIL_SIZE = 640;

export const canvasTools: CanvasTools = {
    reconcile: (local, remote, appState) => reconcileElements(
        local as readonly OrderedExcalidrawElement[],
        restoreElements(remote as unknown as ExcalidrawElement[], null) as unknown as Remote,
        appState as AppState,
    ) as unknown as SceneElement[],
    captureNever: CaptureUpdateAction.NEVER,
    thumbnail: async (elements, files, appState) => {
        const visible = getNonDeletedElements(elements as readonly ExcalidrawElement[]);
        if (!visible.length) {
            return null;
        }
        return exportToBlob({
            elements: visible,
            appState: {...(appState as AppState), exportBackground: true, exportWithDarkMode: false},
            files: files as unknown as BinaryFiles,
            mimeType: 'image/png',
            maxWidthOrHeight: THUMBNAIL_SIZE,
        });
    },
};

function download(filename: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName(title: string) {
    return title.replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim() || 'board';
}

function exported(api: ExcalidrawImperativeAPI) {
    return {
        elements: getNonDeletedElements(api.getSceneElements()),
        appState: {...api.getAppState(), exportBackground: true},
        files: api.getFiles(),
    };
}

// downloadScene saves the board as an .excalidraw file.
export function downloadScene(api: ExcalidrawImperativeAPI, title: string) {
    const json = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), 'local');
    download(`${baseName(title)}.excalidraw`, new Blob([json], {type: 'application/vnd.excalidraw+json'}));
}

export async function downloadPNG(api: ExcalidrawImperativeAPI, title: string) {
    const png = await exportToBlob({...exported(api), mimeType: 'image/png'});
    download(`${baseName(title)}.png`, png);
}

export async function downloadSVG(api: ExcalidrawImperativeAPI, title: string) {
    const svg = await exportToSvg(exported(api));
    download(`${baseName(title)}.svg`, new Blob([svg.outerHTML], {type: 'image/svg+xml'}));
}

// importScene replaces the content of the board by the content of an .excalidraw file.
export async function importScene(api: ExcalidrawImperativeAPI, file: Blob) {
    const scene = await loadFromBlob(file, null, null);
    const files = Object.values(scene.files || {}) as BinaryFileData[];
    if (files.length) {
        api.addFiles(files);
    }
    const nonce = () => Math.floor(Math.random() * (2 ** 31));
    const elements = replacementScene(
        api.getSceneElementsIncludingDeleted() as unknown as SceneElement[],
        scene.elements as unknown as SceneElement[],
        nonce,
    );
    api.updateScene({elements: elements as unknown as ExcalidrawElement[], captureUpdate: CaptureUpdateAction.IMMEDIATELY});
    api.scrollToContent();
}

export type {BoardFile};
