// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {Excalidraw, languages} from '@excalidraw/excalidraw';
import type {ExcalidrawElement} from '@excalidraw/excalidraw/element/types';
import type {ExcalidrawImperativeAPI} from '@excalidraw/excalidraw/types';
import React, {useEffect, useMemo, useState} from 'react';

// eslint-disable-next-line import/no-unresolved
import '@excalidraw/excalidraw/index.css';

import type {default as BoardSession, BoardFile, Canvas} from '../board_session';
import type {SceneElement} from '../scene';

import {canvasTools} from './tools';

// excalidrawLanguage returns Excalidraw's language for a locale of the server (e.g. fr, pt-BR).
function excalidrawLanguage(locale: string) {
    const lower = locale.toLowerCase();
    const exact = languages.find((l) => l.code.toLowerCase() === lower);
    const prefix = languages.find((l) => l.code.toLowerCase().split('-')[0] === lower.split('-')[0]);
    return (exact || prefix)?.code || 'en';
}

type Props = {
    session: BoardSession;
    title: string;
    editable: boolean;
    theme: 'light' | 'dark';
    locale: string;
    onAPI: (api: ExcalidrawImperativeAPI | null) => void;
};

// ExcalidrawCanvas is the Excalidraw (MIT) editor of a board, kept in sync by the session.
export default function ExcalidrawCanvas({session, title, editable, theme, locale, onAPI}: Props) {
    const [api, setAPI] = useState<ExcalidrawImperativeAPI | null>(null);

    useEffect(() => {
        if (!api) {
            return () => null;
        }
        const canvas = api as unknown as Canvas;
        session.attach(canvas, canvasTools);
        onAPI(api);
        return () => {
            session.detach(canvas);
            onAPI(null);
        };
    }, [api, session, onAPI]);

    // The board as the session has it, when the canvas mounts again (e.g. back from full screen)
    const initialData = useMemo(() => ({
        elements: session.elements as unknown as ExcalidrawElement[],
        scrollToContent: true,
    }), [session]);

    return (
        <Excalidraw
            excalidrawAPI={setAPI}
            initialData={initialData}
            isCollaborating={true}
            viewModeEnabled={!editable}
            theme={theme}
            name={title}
            langCode={excalidrawLanguage(locale)}
            onChange={(elements, appState, files) => session.handleChange(elements as unknown as SceneElement[], files as unknown as Record<string, BoardFile>)}
            onPointerUpdate={({pointer, button}) => session.handlePointer(pointer, button, api?.getAppState().selectedElementIds || {})}
            UIOptions={{
                canvasActions: {

                    // Opening a file replaces the board without telling the others: the plugin
                    // imports files itself.
                    loadScene: false,
                    saveToActiveFile: false,
                    toggleTheme: null,
                    export: {saveFileToDisk: true},
                    saveAsImage: true,
                },
            }}
        />
    );
}
