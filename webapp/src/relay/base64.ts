// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

// The relay API carries binary updates as base64 strings.

export function toBase64(data: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < data.length; i += chunk) {
        binary += String.fromCharCode(...data.subarray(i, i + chunk));
    }
    return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        data[i] = binary.charCodeAt(i);
    }
    return data;
}
