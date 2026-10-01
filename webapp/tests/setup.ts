// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import '@testing-library/jest-dom';
import {TextDecoder, TextEncoder} from 'util';

// jsdom doesn't have them
Object.assign(global, {TextEncoder, TextDecoder});
