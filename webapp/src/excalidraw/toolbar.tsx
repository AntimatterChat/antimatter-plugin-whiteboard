// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {ExcalidrawElement} from '@excalidraw/excalidraw/element/types';
import type {AppState, ExcalidrawImperativeAPI} from '@excalidraw/excalidraw/types';
import React from 'react';
import {useIntl} from 'react-intl';

import Icon, {type IconName} from '../ui/icon';
import {cx} from '../ui/web_ui';

// The board's tools, as the mockup draws them: Excalidraw's own toolbars, menus and footer are hidden.
export type ToolType = 'selection' | 'hand' | 'rectangle' | 'ellipse' | 'arrow' | 'freedraw' | 'text' | 'eraser';

const TOOLS: Array<{type: ToolType; icon: IconName; label: {id: string; defaultMessage: string}; drawing: boolean}> = [
    {type: 'selection', icon: 'cursor', label: {id: 'whiteboard.tool.select', defaultMessage: 'Select and move (V)'}, drawing: true},
    {type: 'hand', icon: 'hand', label: {id: 'whiteboard.tool.hand', defaultMessage: 'Move around (H)'}, drawing: false},
    {type: 'rectangle', icon: 'rect', label: {id: 'whiteboard.tool.rect', defaultMessage: 'Rectangle (R)'}, drawing: true},
    {type: 'ellipse', icon: 'ellipse', label: {id: 'whiteboard.tool.ellipse', defaultMessage: 'Ellipse (O)'}, drawing: true},
    {type: 'arrow', icon: 'arrow', label: {id: 'whiteboard.tool.arrow', defaultMessage: 'Arrow (A)'}, drawing: true},
    {type: 'freedraw', icon: 'pen', label: {id: 'whiteboard.tool.pen', defaultMessage: 'Draw (P)'}, drawing: true},
    {type: 'text', icon: 'text', label: {id: 'whiteboard.tool.text', defaultMessage: 'Text (T)'}, drawing: true},
    {type: 'eraser', icon: 'eraser', label: {id: 'whiteboard.tool.eraser', defaultMessage: 'Eraser (E)'}, drawing: true},
];

// The mockup's colours. Excalidraw draws its dark theme by inverting the canvas: each colour is kept as the one that
// shows as the mockup's on a dark board, and as itself on a light one.
export const COLORS: Array<{stroke: string; dark: string}> = [
    {stroke: '#1e1e1e', dark: '#E3E5E8'},
    {stroke: '#6741d9', dark: '#8B5CF6'},
    {stroke: '#0c8599', dark: '#22D3EE'},
    {stroke: '#f08c00', dark: '#F0B232'},
    {stroke: '#e03131', dark: '#F23F43'},
];

type Props = {
    api: ExcalidrawImperativeAPI | null;
    tool: string;
    color: string;
    editable: boolean;
    theme: 'light' | 'dark';
    onUndo: () => void;
};

// recolor gives the selected elements a colour, as a new version of each, which the session sends.
function recolor(api: ExcalidrawImperativeAPI, stroke: string) {
    const selected = api.getAppState().selectedElementIds;
    let changed = false;
    const elements = api.getSceneElementsIncludingDeleted().map((element) => {
        if (!selected[element.id] || element.isDeleted || element.strokeColor === stroke) {
            return element;
        }
        changed = true;
        return {...element, strokeColor: stroke, version: element.version + 1, versionNonce: Math.floor(Math.random() * (2 ** 31)), updated: Date.now()} as ExcalidrawElement;
    });
    api.updateScene({appState: {currentItemStrokeColor: stroke} as Partial<AppState> as AppState, ...(changed ? {elements} : {})});
}

export default function BoardToolbar({api, tool, color, editable, theme, onUndo}: Props) {
    const intl = useIntl();
    if (!api) {
        return <div className={cx('wb-tools')}/>;
    }
    return (
        <div
            className={cx('wb-tools')}
            role='toolbar'
            aria-label={intl.formatMessage({id: 'whiteboard.tools', defaultMessage: 'Whiteboard tools'})}
        >
            {TOOLS.filter((t) => editable || !t.drawing).map((t) => (
                <button
                    key={t.type}
                    type='button'
                    className={tool === t.type ? cx('on') : ''}
                    title={intl.formatMessage(t.label)}
                    aria-label={intl.formatMessage(t.label)}
                    aria-pressed={tool === t.type}
                    onClick={() => api.setActiveTool({type: t.type})}
                >
                    <Icon name={t.icon}/>
                </button>
            ))}
            {editable && (
                <>
                    <span className={cx('sep')}/>
                    {COLORS.map((c) => (
                        <button
                            key={c.stroke}
                            type='button'
                            className={cx('swatch', color === c.stroke && 'on')}
                            style={{'--am-c': theme === 'dark' ? c.dark : c.stroke, '--c': theme === 'dark' ? c.dark : c.stroke} as React.CSSProperties}
                            title={intl.formatMessage({id: 'whiteboard.tool.color', defaultMessage: 'Colour'})}
                            aria-label={intl.formatMessage({id: 'whiteboard.tool.colorOf', defaultMessage: 'Colour {color}'}, {color: theme === 'dark' ? c.dark : c.stroke})}
                            aria-pressed={color === c.stroke}
                            onClick={() => recolor(api, c.stroke)}
                        />
                    ))}
                    <span className={cx('sep')}/>
                    <button
                        type='button'
                        title={intl.formatMessage({id: 'whiteboard.tool.undo', defaultMessage: 'Undo (Ctrl+Z)'})}
                        aria-label={intl.formatMessage({id: 'whiteboard.tool.undo', defaultMessage: 'Undo (Ctrl+Z)'})}
                        onClick={onUndo}
                    >
                        <Icon name='undo'/>
                    </button>
                </>
            )}
            <span className={cx('grow')}/>
            <button
                type='button'
                title={intl.formatMessage({id: 'whiteboard.tool.fit', defaultMessage: 'Show the whole board'})}
                aria-label={intl.formatMessage({id: 'whiteboard.tool.fit', defaultMessage: 'Show the whole board'})}
                onClick={() => api.scrollToContent(api.getSceneElements(), {fitToContent: true, animate: true})}
            >
                <Icon name='expand'/>
            </button>
        </div>
    );
}
