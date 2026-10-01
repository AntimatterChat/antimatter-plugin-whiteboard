// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

// The colors of the collaborators' pointers, from the Fusion mockup.
const palette = ['#F97316', '#C084FC', '#22D3EE', '#8B5CF6', '#23A55A', '#F0B232', '#F472B6', '#4C9AFF'];

// userColor returns the color of a user, the same in every session.
export function userColor(userId: string): string {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = ((hash * 31) + userId.charCodeAt(i)) | 0;
    }
    return palette[Math.abs(hash) % palette.length];
}
