// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"net/http"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAPIMoveToChannel(t *testing.T) {
	ts := newTestService(LogOptions{})
	alice, bob := model.NewId(), model.NewId()
	channelID, otherChannel := model.NewId(), model.NewId()
	ts.access.set(alice, channelID, ReadWrite)
	ts.access.set(bob, channelID, ReadWrite)
	ts.access.set(alice, otherChannel, ReadOnly)

	var titled []string
	ts.OnTitled = func(_ string, doc *Doc) *Doc {
		titled = append(titled, doc.Title)
		return doc
	}

	_, created := ts.do(t, alice, http.MethodPost, "/docs", map[string]any{"title": "Draft"})
	docID := created["id"].(string)
	assert.Empty(t, titled, "a personal document isn't shared")

	// Only its owner moves it, to a channel they can add documents to
	w, _ := ts.do(t, bob, http.MethodPost, "/docs/"+docID+"/move", map[string]any{"channel_id": channelID})
	assert.Equal(t, http.StatusNotFound, w.Code)
	w, _ = ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/move", map[string]any{"channel_id": otherChannel})
	assert.Equal(t, http.StatusForbidden, w.Code)

	w, moved := ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/move", map[string]any{"channel_id": channelID})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, channelID, moved["channel_id"])
	assert.Nil(t, moved["owner_id"])
	assert.Equal(t, []string{"Draft"}, titled)
	assert.Equal(t, EventDocCreated, ts.publisher.Last().Event)

	// It's in the channel's list, no longer in its owner's
	personal, err := ts.Docs.ListPersonal(alice)
	require.NoError(t, err)
	assert.Empty(t, personal)
	channel, err := ts.Docs.ListChannel(channelID)
	require.NoError(t, err)
	require.Len(t, channel, 1)
	assert.Equal(t, docID, channel[0].ID)
	w, _ = ts.do(t, bob, http.MethodGet, "/docs/"+docID, nil)
	assert.Equal(t, http.StatusOK, w.Code)

	// A channel's document doesn't move again
	w, _ = ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/move", map[string]any{"channel_id": channelID})
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Renaming a channel's document tells the plugin, which shares it
	w, _ = ts.do(t, bob, http.MethodPatch, "/docs/"+docID, map[string]any{"title": "Plan"})
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, []string{"Draft", "Plan"}, titled)
}
