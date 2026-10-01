// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/antimatterchat/antimatter-plugin-whiteboard/server/relay"
	"github.com/antimatterchat/antimatter-plugin-whiteboard/server/relay/relaytest"
)

// fakeChannels is a channelAPI with one channel and its members.
type fakeChannels struct {
	channel     *model.Channel
	members     map[string]bool
	permissions map[string]bool
}

func (f *fakeChannels) GetChannel(channelID string) (*model.Channel, *model.AppError) {
	if f.channel == nil || channelID != f.channel.Id {
		return nil, model.NewAppError("GetChannel", "not_found", nil, "", http.StatusNotFound)
	}
	return f.channel, nil
}

func (f *fakeChannels) GetChannelMember(channelID, userID string) (*model.ChannelMember, *model.AppError) {
	if f.channel == nil || channelID != f.channel.Id || !f.members[userID] {
		return nil, model.NewAppError("GetChannelMember", "not_found", nil, "", http.StatusNotFound)
	}
	return &model.ChannelMember{ChannelId: channelID, UserId: userID}, nil
}

func (f *fakeChannels) HasPermissionToChannel(userID, channelID string, permission *model.Permission) bool {
	return f.permissions[userID+"/"+permission.Id]
}

func TestChannelAccess(t *testing.T) {
	alice, bob := model.NewId(), model.NewId()
	channels := &fakeChannels{
		channel:     &model.Channel{Id: model.NewId(), Type: model.ChannelTypeOpen},
		members:     map[string]bool{alice: true},
		permissions: map[string]bool{alice + "/" + model.PermissionManagePublicChannelProperties.Id: true},
	}
	access := channelAccess{api: channels}

	p, err := access.ChannelPermission(alice, channels.channel.Id)
	require.NoError(t, err)
	assert.Equal(t, relay.ReadWrite, p)

	p, err = access.ChannelPermission(bob, channels.channel.Id)
	require.NoError(t, err)
	assert.Equal(t, relay.NoAccess, p)

	assert.True(t, access.CanManageChannel(alice, channels.channel.Id))
	assert.False(t, access.CanManageChannel(bob, channels.channel.Id))

	// Archived channels are read-only
	channels.channel.DeleteAt = 1
	p, err = access.ChannelPermission(alice, channels.channel.Id)
	require.NoError(t, err)
	assert.Equal(t, relay.ReadOnly, p)

	// Nobody manages direct messages
	channels.channel.Type = model.ChannelTypeDirect
	assert.False(t, access.CanManageChannel(alice, channels.channel.Id))
}

func TestEscapeMarkdown(t *testing.T) {
	assert.Equal(t, `Plan \*v2\* \[draft\]`, escapeMarkdown("Plan *v2* [draft]"))
}

// newTestPlugin returns a plugin with in-memory storage, alice being a member of channels.channel.
func newTestPlugin(t *testing.T, alice string) (*Plugin, *plugintest.API, *fakeChannels, *relaytest.KV) {
	channels := &fakeChannels{
		channel: &model.Channel{Id: model.NewId(), Type: model.ChannelTypeOpen},
		members: map[string]bool{alice: true},
	}
	api := &plugintest.API{}
	t.Cleanup(func() { api.AssertExpectations(t) })
	p := &Plugin{}
	p.SetAPI(api)
	kv := relaytest.NewKV()
	p.boards = &boardStore{kv: kv}
	p.service = &relay.Service{
		Docs:             relay.NewDocStore(kv),
		Log:              relay.NewLog(kv, relay.NewLocalLocker(), relay.LogOptions{Merge: sceneMerger{now: time.Now}.merge}),
		Hub:              relay.NewHub(&relaytest.Publisher{}),
		Access:           channelAccess{api: channels},
		MaxUpdateBytes:   1024,
		MaxSnapshotBytes: 1024,
		ValidateUpdate:   validateScene,
		OnDelete: func(doc *relay.Doc) error {
			return p.boards.DeleteBoard(doc.ID)
		},
	}
	p.router = p.newRouter()
	return p, api, channels, kv
}

func serve(p *Plugin, userID, method, path string, body []byte) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, bytes.NewReader(body))
	r.Header.Set("Mattermost-User-Id", userID)
	w := httptest.NewRecorder()
	p.ServeHTTP(nil, w, r)
	return w
}

func serveJSON(p *Plugin, userID, method, path string, body any) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	return serve(p, userID, method, path, data)
}

func TestShare(t *testing.T) {
	alice := model.NewId()
	p, api, channels, _ := newTestPlugin(t, alice)

	w := serveJSON(p, alice, http.MethodPost, "/api/v1/docs", map[string]any{"title": "Flow *v2*", "channel_id": channels.channel.Id})
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var doc relay.Doc
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &doc))

	api.On("HasPermissionToChannel", alice, channels.channel.Id, model.PermissionCreatePost).Return(true)
	api.On("CreatePost", mock.MatchedBy(func(post *model.Post) bool {
		return post.UserId == alice && post.ChannelId == channels.channel.Id && post.Type == boardPostType &&
			post.Message == `Shared a whiteboard: **Flow \*v2\***` && post.GetProp("doc_id") == doc.ID
	})).Return(&model.Post{Id: model.NewId()}, nil)

	w = serveJSON(p, alice, http.MethodPost, "/api/v1/docs/"+doc.ID+"/share", map[string]any{})
	assert.Equal(t, http.StatusCreated, w.Code, w.Body.String())

	// Personal boards can't be shared
	w = serveJSON(p, alice, http.MethodPost, "/api/v1/docs", map[string]any{"title": "Mine"})
	require.Equal(t, http.StatusCreated, w.Code)
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &doc))
	w = serveJSON(p, alice, http.MethodPost, "/api/v1/docs/"+doc.ID+"/share", map[string]any{})
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestFilesAndThumbnail(t *testing.T) {
	alice, bob := model.NewId(), model.NewId()
	p, _, channels, kv := newTestPlugin(t, alice)

	w := serveJSON(p, alice, http.MethodPost, "/api/v1/docs", map[string]any{"channel_id": channels.channel.Id})
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var doc relay.Doc
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &doc))
	base := "/api/v1/docs/" + doc.ID

	// Scenes only
	w = serveJSON(p, alice, http.MethodPost, base+"/updates", map[string]any{"client_id": "c", "data": []byte("not a scene")})
	assert.Equal(t, http.StatusBadRequest, w.Code)
	w = serveJSON(p, alice, http.MethodPost, base+"/updates", map[string]any{"client_id": "c", "data": []byte(`{"elements":[{"id":"a","version":1}]}`)})
	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())

	// Images
	image := map[string]any{"mimeType": "image/png", "dataURL": "data:image/png;base64,iVBORw0KGgo=", "created": 1}
	w = serveJSON(p, alice, http.MethodPut, base+"/files/f1", image)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	w = serveJSON(p, alice, http.MethodPut, base+"/files/f2", map[string]any{"mimeType": "text/html", "dataURL": "data:text/html;base64,PGI+"})
	assert.Equal(t, http.StatusBadRequest, w.Code)
	w = serveJSON(p, alice, http.MethodPut, base+"/files/bad%20id", image)
	assert.Equal(t, http.StatusBadRequest, w.Code)
	w = serveJSON(p, bob, http.MethodPut, base+"/files/f3", image)
	assert.Equal(t, http.StatusNotFound, w.Code)

	w = serve(p, alice, http.MethodGet, base+"/files/f1", nil)
	require.Equal(t, http.StatusOK, w.Code)
	var file BoardFile
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &file))
	assert.Equal(t, "f1", file.ID)
	assert.Equal(t, "data:image/png;base64,iVBORw0KGgo=", file.DataURL)
	w = serve(p, bob, http.MethodGet, base+"/files/f1", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)

	// Thumbnail
	w = serve(p, alice, http.MethodGet, base+"/thumbnail", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
	w = serve(p, alice, http.MethodPut, base+"/thumbnail", []byte("<svg>"))
	assert.Equal(t, http.StatusBadRequest, w.Code)
	png := append([]byte("\x89PNG\r\n\x1a\n"), 1, 2, 3)
	w = serve(p, alice, http.MethodPut, base+"/thumbnail", png)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	w = serve(p, alice, http.MethodGet, base+"/thumbnail", nil)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "image/png", w.Header().Get("Content-Type"))
	assert.Equal(t, png, w.Body.Bytes())

	// Deleting the board deletes everything
	w = serve(p, alice, http.MethodDelete, base, nil)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Empty(t, kv.Keys(""))
}
