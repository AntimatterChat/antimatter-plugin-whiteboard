// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {useEffect, useRef, useState} from 'react';

import Icon, {type IconName} from '../ui/icon';
import {cx} from '../ui/web_ui';

export type MenuItem = {
    icon: IconName;
    label: string;
    danger?: boolean;
    onClick: () => void;
};

// Menu is a button opening a small menu of actions.
export default function Menu({label, items}: {label: string; items: MenuItem[]}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) {
            return () => null;
        }
        const close = (e: MouseEvent | KeyboardEvent) => {
            if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', close);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', close);
        };
    }, [open]);

    return (
        <div
            ref={ref}
            className={cx('wb-menu-wrap')}
        >
            <button
                className={cx('icon-btn')}
                title={label}
                aria-label={label}
                aria-haspopup='menu'
                aria-expanded={open}
                onClick={() => setOpen(!open)}
            >
                <Icon name='dots'/>
            </button>
            {open && (
                <div
                    className={cx('wb-menu')}
                    role='menu'
                >
                    {items.map((item) => (
                        <button
                            key={item.label}
                            role='menuitem'
                            className={cx(item.danger && 'danger')}
                            onClick={() => {
                                setOpen(false);
                                item.onClick();
                            }}
                        >
                            <Icon
                                name={item.icon}
                                size='sm'
                            />
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
