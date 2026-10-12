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

func TestAPIFavorites(t *testing.T) {
	ts := newTestService(LogOptions{})
	alice, bob := model.NewId(), model.NewId()
	channelID := model.NewId()
	ts.access.set(alice, channelID, ReadWrite)

	_, shared := ts.do(t, alice, http.MethodPost, "/docs", map[string]any{"title": "Plan", "channel_id": channelID})
	_, personal := ts.do(t, alice, http.MethodPost, "/docs", map[string]any{"title": "Mine"})
	sharedID, personalID := shared["id"].(string), personal["id"].(string)

	w, _ := ts.do(t, alice, http.MethodPut, "/docs/"+sharedID+"/favorite", nil)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	w, _ = ts.do(t, alice, http.MethodPut, "/docs/"+personalID+"/favorite", nil)
	require.Equal(t, http.StatusOK, w.Code)

	// Someone else's personal document can't be a favorite
	w, _ = ts.do(t, bob, http.MethodPut, "/docs/"+personalID+"/favorite", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)

	// The latest first, and a document tells it's a favorite
	w, _ = ts.do(t, alice, http.MethodGet, "/favorites", nil)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Regexp(t, `^\[\{"id":"`+personalID+`".*\{"id":"`+sharedID+`"`, w.Body.String())
	_, got := ts.do(t, alice, http.MethodGet, "/docs/"+sharedID, nil)
	assert.Equal(t, true, got["favorite"])

	// Losing access to the channel takes its documents out of the favorites
	ts.access.set(alice, channelID, NoAccess)
	w, _ = ts.do(t, alice, http.MethodGet, "/favorites", nil)
	assert.NotContains(t, w.Body.String(), sharedID)

	w, _ = ts.do(t, alice, http.MethodDelete, "/docs/"+personalID+"/favorite", nil)
	require.Equal(t, http.StatusOK, w.Code)
	w, _ = ts.do(t, alice, http.MethodGet, "/favorites", nil)
	assert.Equal(t, "[]\n", w.Body.String())

	// Deleted documents leave the favorites
	ts.access.set(alice, channelID, ReadWrite)
	w, _ = ts.do(t, alice, http.MethodDelete, "/docs/"+sharedID, nil)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	w, _ = ts.do(t, alice, http.MethodGet, "/favorites", nil)
	assert.Equal(t, "[]\n", w.Body.String())
	ids, err := ts.Docs.ListFavorites(alice)
	require.NoError(t, err)
	assert.Empty(t, ids)
}
