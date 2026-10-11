// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {CaptureUpdateAction, FONT_FAMILY, newElementWith, restoreElements} from '@excalidraw/excalidraw';
import type {ExcalidrawElement} from '@excalidraw/excalidraw/element/types';
import type {AppState, ExcalidrawImperativeAPI} from '@excalidraw/excalidraw/types';
import React, {useEffect, useRef, useState} from 'react';
import {useIntl} from 'react-intl';

import Icon, {type IconName} from '../ui/icon';
import {cx} from '../ui/web_ui';

// The board's tools, as the mockup draws them, with Excalidraw's own toolbars, menus and footer hidden: the drawing
// tools, then the colours, the style of strokes and fills, the text's font and size, the library, and undo.
export type ToolType = 'selection' | 'hand' | 'rectangle' | 'ellipse' | 'arrow' | 'freedraw' | 'text' | 'eraser';

type Label = {id: string; defaultMessage: string};

const TOOLS: Array<{type: ToolType; icon: IconName; label: Label; drawing: boolean}> = [
    {type: 'selection', icon: 'cursor', label: {id: 'whiteboard.tool.select', defaultMessage: 'Select and move (V)'}, drawing: true},
    {type: 'hand', icon: 'hand', label: {id: 'whiteboard.tool.hand', defaultMessage: 'Move around (H)'}, drawing: false},
    {type: 'rectangle', icon: 'rect', label: {id: 'whiteboard.tool.rect', defaultMessage: 'Rectangle (R)'}, drawing: true},
    {type: 'ellipse', icon: 'ellipse', label: {id: 'whiteboard.tool.ellipse', defaultMessage: 'Ellipse (O)'}, drawing: true},
    {type: 'arrow', icon: 'arrow', label: {id: 'whiteboard.tool.arrow', defaultMessage: 'Arrow (A)'}, drawing: true},
    {type: 'freedraw', icon: 'pen', label: {id: 'whiteboard.tool.pen', defaultMessage: 'Draw (P)'}, drawing: true},
    {type: 'text', icon: 'text', label: {id: 'whiteboard.tool.text', defaultMessage: 'Text (T)'}, drawing: true},
    {type: 'eraser', icon: 'eraser', label: {id: 'whiteboard.tool.eraser', defaultMessage: 'Eraser (E)'}, drawing: true},
];

// The colours, as Excalidraw keeps them (its light theme's): the strokes', then the fills'.
export const STROKE_COLORS = ['#1e1e1e', '#6741d9', '#1971c2', '#0c8599', '#2f9e44', '#f08c00', '#e03131', '#c2255c'];
const FILL_COLORS = ['transparent', '#d0bfff', '#a5d8ff', '#99e9f2', '#b2f2bb', '#ffec99', '#ffc9c9', '#eebefa'];

// darkColor is how Excalidraw shows a colour on a dark board: it inverts the canvas (invert(93%), hue-rotate(180deg)).
export function darkColor(hex: string): string {
    const m = (/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i).exec(hex);
    if (!m) {
        return hex;
    }
    const [r, g, b] = [m[1], m[2], m[3]].map((c) => (0.93 * 255) + (parseInt(c, 16) * (1 - (2 * 0.93))));

    // hue-rotate(180deg), as CSS filters compute it
    const out = [
        (r * -0.574) + (g * 1.43) + (b * 0.144),
        (r * 0.426) + (g * 0.43) + (b * 0.144),
        (r * 0.426) + (g * 1.43) + (b * -0.856),
    ];
    return '#' + out.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('');
}

const STROKE_WIDTHS: Array<{value: number; label: Label}> = [
    {value: 1, label: {id: 'whiteboard.style.thin', defaultMessage: 'Thin'}},
    {value: 2, label: {id: 'whiteboard.style.bold', defaultMessage: 'Bold'}},
    {value: 4, label: {id: 'whiteboard.style.extraBold', defaultMessage: 'Extra bold'}},
];
const STROKE_STYLES: Array<{value: 'solid' | 'dashed' | 'dotted'; label: Label}> = [
    {value: 'solid', label: {id: 'whiteboard.style.solid', defaultMessage: 'Solid'}},
    {value: 'dashed', label: {id: 'whiteboard.style.dashed', defaultMessage: 'Dashed'}},
    {value: 'dotted', label: {id: 'whiteboard.style.dotted', defaultMessage: 'Dotted'}},
];
const FILL_STYLES: Array<{value: 'hachure' | 'cross-hatch' | 'solid'; label: Label}> = [
    {value: 'hachure', label: {id: 'whiteboard.style.hachure', defaultMessage: 'Hatched'}},
    {value: 'cross-hatch', label: {id: 'whiteboard.style.crossHatch', defaultMessage: 'Cross-hatched'}},
    {value: 'solid', label: {id: 'whiteboard.style.solidFill', defaultMessage: 'Solid'}},
];
const FONTS: Array<{value: number; label: Label}> = [
    {value: FONT_FAMILY.Excalifont, label: {id: 'whiteboard.text.hand', defaultMessage: 'Hand-drawn'}},
    {value: FONT_FAMILY.Nunito, label: {id: 'whiteboard.text.normal', defaultMessage: 'Normal'}},
    {value: FONT_FAMILY['Comic Shanns'], label: {id: 'whiteboard.text.code', defaultMessage: 'Code'}},
];
const FONT_SIZES: Array<{value: number; label: string}> = [{value: 16, label: 'S'}, {value: 20, label: 'M'}, {value: 28, label: 'L'}, {value: 36, label: 'XL'}];

type ElementPatch = Record<string, unknown>;

// applyStyle gives the selected elements (and the text of the shapes selected) a style, as new versions the session
// sends, and makes it the style of what's drawn next.
function applyStyle(api: ExcalidrawImperativeAPI, appState: Partial<AppState>, patch: ElementPatch, text = false) {
    const state = api.getAppState();
    const selected = new Set(Object.keys(state.selectedElementIds).filter((id) => state.selectedElementIds[id]));
    const all = api.getSceneElementsIncludingDeleted();

    // A shape's text follows its text style
    if (text) {
        for (const element of all) {
            if (selected.has(element.id)) {
                element.boundElements?.filter((b) => b.type === 'text').forEach((b) => selected.add(b.id));
            }
        }
    }

    let changed = false;
    const elements = all.map((element) => {
        if (!selected.has(element.id) || element.isDeleted || (text && element.type !== 'text')) {
            return element;
        }
        const own = Object.fromEntries(Object.entries(patch).filter(([key, value]) => key in element && (element as unknown as ElementPatch)[key] !== value));
        if (!Object.keys(own).length) {
            return element;
        }
        changed = true;
        const updated = newElementWith(element, own as Parameters<typeof newElementWith>[1]);

        // A text set in another font or size takes the room it needs
        return text ? restoreElements([updated], null, {refreshDimensions: true})[0] as ExcalidrawElement : updated;
    });
    api.updateScene({
        appState: {...state, ...appState},
        ...(changed ? {elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY} : {}),
    });
}

type Props = {
    api: ExcalidrawImperativeAPI | null;
    appState: Pick<AppState, 'currentItemStrokeColor' | 'currentItemBackgroundColor' | 'currentItemStrokeWidth' | 'currentItemStrokeStyle' | 'currentItemFillStyle' | 'currentItemFontFamily' | 'currentItemFontSize'> & {tool: string};
    editable: boolean;
    theme: 'light' | 'dark';
    onUndo: () => void;
    onLibrary: () => void;
};

type MenuName = 'color' | 'style' | 'text';

export default function BoardToolbar({api, appState, editable, theme, onUndo, onLibrary}: Props) {
    const intl = useIntl();
    const [menu, setMenu] = useState<MenuName | null>(null);
    const ref = useRef<HTMLDivElement>(null);
    const shown = (color: string) => (theme === 'dark' ? darkColor(color) : color);

    // A menu closes on a click elsewhere, or Escape
    useEffect(() => {
        if (!menu) {
            return () => null;
        }
        const onPointerDown = (e: PointerEvent) => {
            if (!ref.current?.contains(e.target as Node)) {
                setMenu(null);
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                setMenu(null);
            }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [menu]);

    if (!api) {
        return <div className={cx('wb-tools')}/>;
    }

    const menuButton = (name: MenuName, label: string, content: React.ReactNode) => (
        <button
            type='button'
            className={menu === name ? cx('on') : ''}
            title={label}
            aria-label={label}
            aria-haspopup='dialog'
            aria-expanded={menu === name}
            onClick={() => setMenu(menu === name ? null : name)}
        >
            {content}
        </button>
    );
    const choice = (on: boolean, label: string, onClick: () => void, content: React.ReactNode = label) => (
        <button
            key={label}
            type='button'
            className={cx('wb-choice', on && 'on')}
            title={label}
            aria-label={label}
            aria-pressed={on}
            onClick={onClick}
        >
            {content}
        </button>
    );
    const swatch = (color: string, on: boolean, label: string, onClick: () => void) => (
        <button
            key={color}
            type='button'
            className={cx('swatch', on && 'on', color === 'transparent' && 'swatch-none')}
            style={{'--am-c': shown(color), '--c': shown(color)} as React.CSSProperties}
            title={label}
            aria-label={label}
            aria-pressed={on}
            onClick={onClick}
        />
    );

    return (
        <div
            ref={ref}
            className={cx('wb-tools')}
            role='toolbar'
            aria-label={intl.formatMessage({id: 'whiteboard.tools', defaultMessage: 'Whiteboard tools'})}
        >
            {TOOLS.filter((t) => editable || !t.drawing).map((t) => (
                <button
                    key={t.type}
                    type='button'
                    className={appState.tool === t.type ? cx('on') : ''}
                    title={intl.formatMessage(t.label)}
                    aria-label={intl.formatMessage(t.label)}
                    aria-pressed={appState.tool === t.type}
                    onClick={() => api.setActiveTool({type: t.type})}
                >
                    <Icon name={t.icon}/>
                </button>
            ))}
            {editable && (
                <>
                    <span className={cx('sep')}/>
                    {menuButton('color', intl.formatMessage({id: 'whiteboard.tool.colors', defaultMessage: 'Colours'}), (
                        <span
                            className={cx('wb-color-dot')}
                            style={{'--c': shown(appState.currentItemStrokeColor), '--f': appState.currentItemBackgroundColor === 'transparent' ? 'transparent' : shown(appState.currentItemBackgroundColor)} as React.CSSProperties}
                        />
                    ))}
                    {menuButton('style', intl.formatMessage({id: 'whiteboard.tool.style', defaultMessage: 'Strokes and fills'}), <Icon name='stroke'/>)}
                    {menuButton('text', intl.formatMessage({id: 'whiteboard.tool.textStyle', defaultMessage: 'Font and size'}), <Icon name='type'/>)}
                    <span className={cx('sep')}/>
                    <button
                        type='button'
                        title={intl.formatMessage({id: 'whiteboard.tool.library', defaultMessage: 'Library'})}
                        aria-label={intl.formatMessage({id: 'whiteboard.tool.library', defaultMessage: 'Library'})}
                        onClick={onLibrary}
                    >
                        <Icon name='library'/>
                    </button>
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
            {menu && (
                <div
                    className={cx('wb-pop')}
                    role='dialog'
                    aria-label={intl.formatMessage({id: 'whiteboard.tool.menu', defaultMessage: 'Style'})}
                >
                    {menu === 'color' && (
                        <>
                            <div className={cx('wb-pop-h')}>{intl.formatMessage({id: 'whiteboard.color.stroke', defaultMessage: 'Stroke'})}</div>
                            <div className={cx('wb-pop-row')}>
                                {STROKE_COLORS.map((c) => swatch(c, appState.currentItemStrokeColor === c, intl.formatMessage({id: 'whiteboard.color.strokeOf', defaultMessage: 'Stroke {color}'}, {color: shown(c)}), () => applyStyle(api, {currentItemStrokeColor: c}, {strokeColor: c})))}
                            </div>
                            <div className={cx('wb-pop-h')}>{intl.formatMessage({id: 'whiteboard.color.fill', defaultMessage: 'Fill'})}</div>
                            <div className={cx('wb-pop-row')}>
                                {FILL_COLORS.map((c) => swatch(c, appState.currentItemBackgroundColor === c, c === 'transparent' ? intl.formatMessage({id: 'whiteboard.color.noFill', defaultMessage: 'No fill'}) : intl.formatMessage({id: 'whiteboard.color.fillOf', defaultMessage: 'Fill {color}'}, {color: shown(c)}), () => applyStyle(api, {currentItemBackgroundColor: c}, {backgroundColor: c})))}
                            </div>
                        </>
                    )}
                    {menu === 'style' && (
                        <>
                            <div className={cx('wb-pop-h')}>{intl.formatMessage({id: 'whiteboard.style.width', defaultMessage: 'Stroke width'})}</div>
                            <div className={cx('wb-pop-row')}>
                                {STROKE_WIDTHS.map((w) => choice(appState.currentItemStrokeWidth === w.value, intl.formatMessage(w.label), () => applyStyle(api, {currentItemStrokeWidth: w.value}, {strokeWidth: w.value}), (
                                    <span
                                        className={cx('wb-line')}
                                        style={{'--w': `${w.value + 1}px`} as React.CSSProperties}
                                    />
                                )))}
                            </div>
                            <div className={cx('wb-pop-h')}>{intl.formatMessage({id: 'whiteboard.style.stroke', defaultMessage: 'Stroke style'})}</div>
                            <div className={cx('wb-pop-row')}>
                                {STROKE_STYLES.map((s) => choice(appState.currentItemStrokeStyle === s.value, intl.formatMessage(s.label), () => applyStyle(api, {currentItemStrokeStyle: s.value}, {strokeStyle: s.value}), (
                                    <span
                                        className={cx('wb-line')}
                                        style={{'--w': '2px', '--s': s.value} as React.CSSProperties}
                                    />
                                )))}
                            </div>
                            <div className={cx('wb-pop-h')}>{intl.formatMessage({id: 'whiteboard.style.fill', defaultMessage: 'Fill style'})}</div>
                            <div className={cx('wb-pop-row')}>
                                {FILL_STYLES.map((f) => choice(appState.currentItemFillStyle === f.value, intl.formatMessage(f.label), () => applyStyle(api, {currentItemFillStyle: f.value}, {fillStyle: f.value}), (
                                    <span className={cx('wb-fill', `wb-fill-${f.value}`)}/>
                                )))}
                            </div>
                        </>
                    )}
                    {menu === 'text' && (
                        <>
                            <div className={cx('wb-pop-h')}>{intl.formatMessage({id: 'whiteboard.text.font', defaultMessage: 'Font'})}</div>
                            <div className={cx('wb-pop-row')}>
                                {FONTS.map((f) => choice(appState.currentItemFontFamily === f.value, intl.formatMessage(f.label), () => applyStyle(api, {currentItemFontFamily: f.value as AppState['currentItemFontFamily']}, {fontFamily: f.value}, true)))}
                            </div>
                            <div className={cx('wb-pop-h')}>{intl.formatMessage({id: 'whiteboard.text.size', defaultMessage: 'Size'})}</div>
                            <div className={cx('wb-pop-row')}>
                                {FONT_SIZES.map((s) => choice(appState.currentItemFontSize === s.value, s.label, () => applyStyle(api, {currentItemFontSize: s.value}, {fontSize: s.value}, true)))}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
