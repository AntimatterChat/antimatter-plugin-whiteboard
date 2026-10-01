// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/antimatterchat/antimatter-plugin-whiteboard/server/relay/relaytest"
)

func TestDocStore(t *testing.T) {
	store := NewDocStore(relaytest.NewKV())
	channelID := model.NewId()
	userID := model.NewId()

	channelDoc := &Doc{ID: model.NewId(), Title: "Plan", ChannelID: channelID, CreatorID: userID}
	personalDoc := &Doc{ID: model.NewId(), Title: "Mine", OwnerID: userID, CreatorID: userID}
	require.NoError(t, store.Create(channelDoc))
	require.NoError(t, store.Create(personalDoc))
	assert.False(t, channelDoc.IsPersonal())
	assert.True(t, personalDoc.IsPersonal())

	docs, err := store.ListChannel(channelID)
	require.NoError(t, err)
	require.Len(t, docs, 1)
	assert.Equal(t, "Plan", docs[0].Title)

	docs, err = store.ListPersonal(userID)
	require.NoError(t, err)
	require.Len(t, docs, 1)
	assert.Equal(t, "Mine", docs[0].Title)

	docs, err = store.ListChannel(model.NewId())
	require.NoError(t, err)
	assert.Empty(t, docs)

	updated, err := store.Update(channelDoc.ID, func(d *Doc) bool {
		d.Title = "Renamed"
		return true
	})
	require.NoError(t, err)
	assert.Equal(t, "Renamed", updated.Title)
	got, err := store.Get(channelDoc.ID)
	require.NoError(t, err)
	assert.Equal(t, "Renamed", got.Title)

	require.NoError(t, store.Delete(channelDoc))
	got, err = store.Get(channelDoc.ID)
	require.NoError(t, err)
	assert.Nil(t, got)
	docs, err = store.ListChannel(channelID)
	require.NoError(t, err)
	assert.Empty(t, docs)

	// Updating a deleted document doesn't bring it back
	updated, err = store.Update(channelDoc.ID, func(d *Doc) bool {
		d.Title = "Zombie"
		return true
	})
	require.NoError(t, err)
	assert.Nil(t, updated)
	got, err = store.Get(channelDoc.ID)
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestDocStoreLimit(t *testing.T) {
	store := NewDocStore(relaytest.NewKV())
	channelID := model.NewId()
	for range MaxDocsPerIndex {
		require.NoError(t, store.Create(&Doc{ID: model.NewId(), ChannelID: channelID}))
	}
	assert.ErrorIs(t, store.Create(&Doc{ID: model.NewId(), ChannelID: channelID}), ErrTooManyDocs)
}
