// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

// Package relay keeps collaborative documents for a plugin: a registry of the documents of the
// channels and of each user, an append-only log of the updates of each document, compacted into
// snapshots, and the relay of the updates and of the presence of the editors to the other editors
// over the plugin websocket events.
//
// The relay doesn't understand the updates: they are opaque bytes, e.g. Yjs updates or Excalidraw
// elements. Snapshots are either posted by the clients (who merge the updates themselves) or merged
// by the server with a MergeFunc.
//
// The package is shared by the Antimatter notes and whiteboard plugins: it is copied in both
// repositories (server/relay) and must be kept in sync.
package relay
