// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {Excalidraw, languages} from '@excalidraw/excalidraw';
import type {ExcalidrawElement} from '@excalidraw/excalidraw/element/types';
import type {AppState, ExcalidrawImperativeAPI, LibraryItems} from '@excalidraw/excalidraw/types';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

// eslint-disable-next-line import/no-unresolved
import '@excalidraw/excalidraw/index.css';

// Excalidraw's interface, its portalled dialogs and menus included, in Fusion's colours under the Fusion UI.
import './fusion_theme.css';

import type {default as BoardSession, BoardFile, Canvas} from '../board_session';
import {loadPersonalItems, savePersonalItems, withSharedItems, type LibraryItem} from '../libraries';
import type {SceneElement} from '../scene';
import {cx} from '../ui/web_ui';

import {installLibraryNote, LibraryNoteContext, type LibraryNoteState} from './library_note';
import BoardToolbar from './toolbar';
import {canvasTools} from './tools';

// excalidrawLanguage returns Excalidraw's language for a locale of the server (e.g. fr, pt-BR).
function excalidrawLanguage(locale: string) {
    const lower = locale.toLowerCase();
    const exact = languages.find((l) => l.code.toLowerCase() === lower);
    const prefix = languages.find((l) => l.code.toLowerCase().split('-')[0] === lower.split('-')[0]);
    return (exact || prefix)?.code || 'en';
}

installLibraryNote();

type ToolbarState = React.ComponentProps<typeof BoardToolbar>['appState'];

// The style of what's drawn next, until Excalidraw tells its own.
const DEFAULT_STYLE: ToolbarState = {
    tool: 'selection',
    currentItemStrokeColor: '#1e1e1e',
    currentItemBackgroundColor: 'transparent',
    currentItemStrokeWidth: 2,
    currentItemStrokeStyle: 'solid',
    currentItemFillStyle: 'solid',
    currentItemFontFamily: 5,
    currentItemFontSize: 20,
};

function toolbarState(appState: AppState): ToolbarState {
    return {
        tool: appState.activeTool.type,
        currentItemStrokeColor: appState.currentItemStrokeColor,
        currentItemBackgroundColor: appState.currentItemBackgroundColor,
        currentItemStrokeWidth: appState.currentItemStrokeWidth,
        currentItemStrokeStyle: appState.currentItemStrokeStyle,
        currentItemFillStyle: appState.currentItemFillStyle,
        currentItemFontFamily: appState.currentItemFontFamily,
        currentItemFontSize: appState.currentItemFontSize,
    };
}

const sameState = (a: ToolbarState, b: ToolbarState) => (Object.keys(a) as Array<keyof ToolbarState>).every((key) => a[key] === b[key]);

type Props = {
    session: BoardSession;
    title: string;
    editable: boolean;
    theme: 'light' | 'dark';
    locale: string;
    onAPI: (api: ExcalidrawImperativeAPI | null) => void;

    // The items of the libraries of the board's community, and what the library offers to get more
    sharedItems: LibraryItem[];
    libraryNote: LibraryNoteState;
};

// ExcalidrawCanvas is the Excalidraw (MIT) editor of a board, kept in sync by the session, under the board's toolbar.
export default function ExcalidrawCanvas({session, title, editable, theme, locale, onAPI, sharedItems, libraryNote}: Props) {
    const [api, setAPI] = useState<ExcalidrawImperativeAPI | null>(null);

    // Excalidraw loads its initial data after giving its API, and that replaces the scene: the session takes the
    // canvas once it has (its state is no longer loading), or the board it draws would vanish.
    const [loaded, setLoaded] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<ToolbarState>(DEFAULT_STYLE);

    // Excalidraw has no undo in its API: its own button, hidden with the rest of its interface, does it. It's found by
    // its test ID: its label is translated.
    const undo = useCallback(() => {
        (wrap.current?.querySelector('.layer-ui__wrapper [data-testid="button-undo"]') as HTMLButtonElement | null)?.click();
    }, []);

    // The library: the user's own items, kept in the browser, and the items of the community's libraries. Both are
    // in the initial data; once it's loaded, the shared items follow the libraries, and the user's are saved.
    const shared = useRef(sharedItems);
    shared.current = sharedItems;
    const loadedRef = useRef(false);
    loadedRef.current = loaded;
    useEffect(() => {
        if (api && loaded) {
            api.updateLibrary({libraryItems: (current) => withSharedItems(current, sharedItems as unknown as LibraryItems), merge: false});
        }
    }, [api, loaded, sharedItems]);
    const saveLibrary = useCallback((items: LibraryItems) => {
        if (loadedRef.current) {
            savePersonalItems(items);
        }
    }, []);
    const library = useCallback(() => api?.toggleSidebar({name: 'default', tab: 'library'}), [api]);

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
        libraryItems: withSharedItems(loadPersonalItems(), shared.current) as unknown as LibraryItems,
    }), [session]);

    return (
        <LibraryNoteContext.Provider value={libraryNote}>
            <div
                ref={wrap}
                className={cx('wb-engine')}
            >
                <BoardToolbar
                    api={api}
                    appState={style}
                    editable={editable}
                    theme={theme}
                    onUndo={undo}
                    onLibrary={library}
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
                        onLibraryChange={saveLibrary}

                        // Web pages embedded in boards would load from other sites
                        validateEmbeddable={false}
                        onChange={(elements, appState, files) => {
                            const next = toolbarState(appState);
                            setStyle((old) => (sameState(old, next) ? old : next));
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
        </LibraryNoteContext.Provider>
    );
}
