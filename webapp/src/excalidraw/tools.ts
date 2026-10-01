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

// replaceContent replaces the content of the board by other elements and their images, for
// everyone. It's an edit: it can be undone.
function replaceContent(api: ExcalidrawImperativeAPI, elements: readonly SceneElement[], files: readonly BinaryFileData[]) {
    if (files.length) {
        api.addFiles([...files]);
    }
    const nonce = () => Math.floor(Math.random() * (2 ** 31));
    const replacement = replacementScene(
        api.getSceneElementsIncludingDeleted() as unknown as SceneElement[],
        elements,
        nonce,
    );
    api.updateScene({elements: replacement as unknown as ExcalidrawElement[], captureUpdate: CaptureUpdateAction.IMMEDIATELY});
    api.scrollToContent();
}

// importScene replaces the content of the board by the content of an .excalidraw file.
export async function importScene(api: ExcalidrawImperativeAPI, file: Blob) {
    const scene = await loadFromBlob(file, null, null);
    replaceContent(api, scene.elements as unknown as SceneElement[], Object.values(scene.files || {}) as BinaryFileData[]);
}

// restoreVersion replaces the content of the board by a past version of it.
export function restoreVersion(api: ExcalidrawImperativeAPI, elements: readonly SceneElement[], files: readonly BoardFile[]) {
    replaceContent(api, elements.filter((e) => !e.isDeleted), files as unknown as BinaryFileData[]);
}

// versionSVG draws a past version of the board, for its preview.
export async function versionSVG(elements: readonly SceneElement[], files: readonly BoardFile[], dark: boolean): Promise<string> {
    const svg = await exportToSvg({
        elements: getNonDeletedElements(elements as readonly ExcalidrawElement[]),
        appState: {exportBackground: true, exportWithDarkMode: dark, viewBackgroundColor: '#ffffff'},
        files: Object.fromEntries(files.map((f) => [f.id, f])) as unknown as BinaryFiles,
    });
    return svg.outerHTML;
}

export type {BoardFile};
