// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {Excalidraw, languages} from '@excalidraw/excalidraw';
import type {ExcalidrawElement} from '@excalidraw/excalidraw/element/types';
import type {AppState, ExcalidrawImperativeAPI} from '@excalidraw/excalidraw/types';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

// eslint-disable-next-line import/no-unresolved
import '@excalidraw/excalidraw/index.css';

import type {default as BoardSession, BoardFile, Canvas} from '../board_session';
import type {SceneElement} from '../scene';
import {cx} from '../ui/web_ui';

import BoardToolbar from './toolbar';
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

    // Excalidraw loads its initial data after giving its API, and that replaces the scene: the session takes the
    // canvas once it has (its state is no longer loading), or the board it draws would vanish.
    const [loaded, setLoaded] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);
    const [tool, setTool] = useState('selection');
    const [color, setColor] = useState('#1e1e1e');

    // Excalidraw has no undo in its API: its own button, hidden with the rest of its interface, does it.
    const undo = useCallback(() => {
        (wrap.current?.querySelector('.layer-ui__wrapper [aria-label="Undo"]') as HTMLButtonElement | null)?.click();
    }, []);

    useEffect(() => {
        if (!api || !loaded) {
            return () => null;
        }
        const canvas = api as unknown as Canvas;
        session.attach(canvas, canvasTools);
        onAPI(api);
        return () => {
            session.detach(canvas);
            onAPI(null);
        };
    }, [api, loaded, session, onAPI]);

    // A board opens showing all of it, as large as the panel allows, never more than its actual size.
    const fitted = useRef(false);
    useEffect(() => {
        if (!api || !loaded || fitted.current) {
            return () => null;
        }
        fitted.current = true;
        const timer = setTimeout(() => {
            const elements = api.getSceneElements();
            if (!elements.length) {
                return;
            }
            api.scrollToContent(elements, {fitToViewport: true, viewportZoomFactor: 0.9});
            if (api.getAppState().zoom.value > 1) {
                api.updateScene({appState: {...api.getAppState(), zoom: {value: 1 as AppState['zoom']['value']}}});
                api.scrollToContent(elements);
            }
        });
        return () => clearTimeout(timer);
    }, [api, loaded]);

    // The board as the session has it, when the canvas mounts again (e.g. back from full screen)
    const initialData = useMemo(() => ({
        elements: session.elements as unknown as ExcalidrawElement[],
        appState: {viewBackgroundColor: 'transparent'},
        scrollToContent: true,
    }), [session]);

    return (
        <div
            ref={wrap}
            className={cx('wb-engine')}
        >
            <BoardToolbar
                api={api}
                tool={tool}
                color={color}
                editable={editable}
                theme={theme}
                onUndo={undo}
            />
            <div className={cx('wb-stage')}>
                <Excalidraw
                    excalidrawAPI={setAPI}
                    initialData={initialData}
                    isCollaborating={true}
                    viewModeEnabled={!editable}
                    theme={theme}
                    name={title}
                    langCode={excalidrawLanguage(locale)}
                    onChange={(elements, appState, files) => {
                        setTool(appState.activeTool.type);
                        setColor(appState.currentItemStrokeColor);
                        if (!loaded) {
                            if (!appState.isLoading) {
                                setLoaded(true);
                            }
                            return;
                        }
                        session.handleChange(elements as unknown as SceneElement[], files as unknown as Record<string, BoardFile>);
                    }}
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
            </div>
        </div>
    );
}
