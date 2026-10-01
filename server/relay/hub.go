// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"encoding/base64"
	"encoding/json"

	"github.com/mattermost/mattermost/server/public/model"
)

// Websocket events, sent as custom_<plugin id>_<event>.
const (
	EventUpdate     = "update"
	EventAwareness  = "awareness"
	EventDocCreated = "doc_created"
	EventDocUpdated = "doc_updated"
	EventDocDeleted = "doc_deleted"
	EventReset      = "doc_reset"
)

// Publisher sends websocket events (implemented by plugin.API).
type Publisher interface {
	PublishWebSocketEvent(event string, payload map[string]any, broadcast *model.WebsocketBroadcast)
}

// Hub sends the events of a document to the people who can open it: the members of its channel,
// or its owner.
type Hub struct {
	publisher Publisher

	// InlineLimit is the size above which updates aren't sent in the events: clients fetch them.
	InlineLimit int
}

func NewHub(publisher Publisher) *Hub {
	return &Hub{publisher: publisher, InlineLimit: 32 * 1024}
}

func audience(doc *Doc) *model.WebsocketBroadcast {
	if doc.IsPersonal() {
		return &model.WebsocketBroadcast{UserId: doc.OwnerID}
	}
	return &model.WebsocketBroadcast{ChannelId: doc.ChannelID}
}

// The payloads only hold strings, numbers and booleans, which go through the plugin RPC.

// Update tells the editors of a document about a new update.
func (h *Hub) Update(doc *Doc, clientID string, seq int64, data []byte) {
	payload := map[string]any{
		"doc_id":    doc.ID,
		"client_id": clientID,
		"seq":       seq,
	}
	if len(data) <= h.InlineLimit {
		payload["data"] = base64.StdEncoding.EncodeToString(data)
	}
	h.publisher.PublishWebSocketEvent(EventUpdate, payload, audience(doc))
}

// Awareness relays the presence of an editor (cursor, selection, name...) to the others.
func (h *Hub) Awareness(doc *Doc, clientID string, data []byte) {
	h.publisher.PublishWebSocketEvent(EventAwareness, map[string]any{
		"doc_id":    doc.ID,
		"client_id": clientID,
		"data":      base64.StdEncoding.EncodeToString(data),
	}, audience(doc))
}

// Reset tells the editors of a document to load it again, e.g. after a version was restored.
func (h *Hub) Reset(doc *Doc) {
	h.publisher.PublishWebSocketEvent(EventReset, map[string]any{"doc_id": doc.ID}, audience(doc))
}

// DocChanged tells about a created, renamed or deleted document.
func (h *Hub) DocChanged(event string, doc *Doc) {
	data, err := json.Marshal(doc)
	if err != nil {
		return
	}
	h.publisher.PublishWebSocketEvent(event, map[string]any{"doc_id": doc.ID, "doc": string(data)}, audience(doc))
}
