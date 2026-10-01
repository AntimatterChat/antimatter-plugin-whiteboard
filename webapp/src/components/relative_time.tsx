// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {useEffect, useState} from 'react';
import {FormattedRelativeTime} from 'react-intl';

const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 24 * 3600],
    ['month', 30 * 24 * 3600],
    ['week', 7 * 24 * 3600],
    ['day', 24 * 3600],
    ['hour', 3600],
    ['minute', 60],
];

// RelativeTime shows how long ago something happened ("5 minutes ago"), updated every minute.
export default function RelativeTime({value}: {value: number}) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60000);
        return () => clearInterval(timer);
    }, []);

    const seconds = Math.round((value - now) / 1000);
    for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) {
            return (
                <FormattedRelativeTime
                    value={Math.round(seconds / size)}
                    unit={unit}
                    numeric='auto'
                />
            );
        }
    }
    return (
        <FormattedRelativeTime
            value={0}
            unit='second'
            numeric='auto'
        />
    );
}
