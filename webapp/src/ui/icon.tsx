// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React from 'react';

import {cx, isFusionUI} from './web_ui';

// The icons used by the plugin: Fusion's icon sprite names, and the classic UI's compass icons.
const classicIcons = {
    draw: 'draw',
    plus: 'plus',
    dots: 'dots-vertical',
    x: 'close',
    chev: 'chevron-left',
    export: 'download-outline',
    upload: 'upload-outline',
    forward: 'share-variant-outline',
    trash: 'trash-can-outline',
    lock: 'lock-outline',
    hash: 'pound',
    users: 'account-multiple-outline',
    fullscreen: 'arrow-expand',
    clock: 'clock-outline',
    cursor: 'cursor-default-outline',
    hand: 'hand-right',
    rect: 'square-outline',
    ellipse: 'circle-outline',
    arrow: 'arrow-right',
    pen: 'pencil-outline',
    text: 'format-letter-case',
    eraser: 'eraser',
    undo: 'arrow-u-left-top',
    expand: 'arrow-expand-all',
} as const;

export type IconName = keyof typeof classicIcons;

type Props = {
    name: IconName;
    size?: 'sm' | 'xs';
};

export default function Icon({name, size}: Props) {
    if (isFusionUI()) {
        return (
            <svg
                className={cx('ic', size, name === 'chev' && 'ic-back')}
                aria-hidden='true'
            >
                <use href={`#am-i-${name}`}/>
            </svg>
        );
    }
    return (
        <i
            className={`icon icon-${classicIcons[name]}`}
            aria-hidden='true'
        />
    );
}
