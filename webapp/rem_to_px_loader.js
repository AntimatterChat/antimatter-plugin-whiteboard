// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

// Excalidraw is sized in rem, for pages with a 16px root font size. The web app's root font size
// is 10px, which shrinks Excalidraw's interface: this loader turns Excalidraw's rem into pixels.
// In JavaScript, only string literals made of a length in rem are changed.

const toPx = (rem) => `${Math.round(parseFloat(rem) * 16 * 100) / 100}px`;

module.exports = function remToPx(source) {
    if (this.resourcePath.endsWith('.css')) {
        return source.replace(/(-?\d*\.?\d+)rem\b/g, (_, rem) => toPx(rem));
    }
    return source.replace(/(["'])(-?\d*\.?\d+)rem\1/g, (_, quote, rem) => quote + toPx(rem) + quote);
};
