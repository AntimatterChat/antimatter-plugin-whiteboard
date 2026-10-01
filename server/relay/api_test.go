// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/antimatterchat/antimatter-plugin-whiteboard/server/relay/relaytest"
)

type testService struct {
	*Service
	router    *mux.Router
	kv        *relaytest.KV
	publisher *relaytest.Publisher
	access    *fakeAccess
}

func newTestService(opts LogOptions) *testService {
	kv := relaytest.NewKV()
	publisher := &relaytest.Publisher{}
	access := newFakeAccess()
	s := &Service{
		Docs:              NewDocStore(kv),
		Log:               NewLog(kv, NewLocalLocker(), opts),
		Hub:               NewHub(publisher),
		Access:            access,
		DefaultTitle:      "Untitled",
		MaxUpdateBytes:    1024,
		MaxSnapshotBytes:  4096,
		MaxAwarenessBytes: 256,
	}
	router := mux.NewRouter()
	s.RegisterRoutes(router)
	return &testService{Service: s, router: router, kv: kv, publisher: publisher, access: access}
}

func (ts *testService) do(t *testing.T, userID, method, path string, body any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		data, err := json.Marshal(body)
		require.NoError(t, err)
		reader = bytes.NewReader(data)
	} else {
		reader = bytes.NewReader(nil)
	}
	r := httptest.NewRequest(method, path, reader)
	r.Header.Set("Mattermost-User-Id", userID)
	w := httptest.NewRecorder()
	ts.router.ServeHTTP(w, r)

	var result map[string]any
	if strings.HasPrefix(strings.TrimSpace(w.Body.String()), "{") {
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	}
	return w, result
}

func b64(s string) string {
	return base64.StdEncoding.EncodeToString([]byte(s))
}

func TestAPIChannelDocument(t *testing.T) {
	ts := newTestService(LogOptions{CompactAfterUpdates: 2})
	alice, bob, eve := model.NewId(), model.NewId(), model.NewId()
	channelID := model.NewId()
	ts.access.set(alice, channelID, ReadWrite)
	ts.access.set(bob, channelID, ReadOnly)

	// Non-members can't add documents
	w, _ := ts.do(t, eve, http.MethodPost, "/docs", map[string]any{"title": "Plan", "channel_id": channelID})
	assert.Equal(t, http.StatusForbidden, w.Code)

	w, created := ts.do(t, alice, http.MethodPost, "/docs", map[string]any{"title": "  Plan  ", "channel_id": channelID})
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	docID := created["id"].(string)
	assert.Equal(t, "Plan", created["title"])
	assert.Equal(t, true, created["can_edit"])
	assert.Equal(t, true, created["can_delete"])
	assert.Equal(t, EventDocCreated, ts.publisher.Last().Event)
	assert.Equal(t, channelID, ts.publisher.Last().Broadcast.ChannelId)

	// Members list it, read-only members can't edit it
	w, _ = ts.do(t, bob, http.MethodGet, "/docs?channel_id="+channelID, nil)
	require.Equal(t, http.StatusOK, w.Code)
	var list []map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &list))
	require.Len(t, list, 1)
	assert.Equal(t, false, list[0]["can_edit"])

	w, _ = ts.do(t, eve, http.MethodGet, "/docs?channel_id="+channelID, nil)
	assert.Equal(t, http.StatusForbidden, w.Code)
	w, _ = ts.do(t, eve, http.MethodGet, "/docs/"+docID+"/state", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)

	// Updates are stored and relayed to the channel
	w, result := ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/updates", map[string]any{"client_id": "c-1", "data": b64("u1")})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.EqualValues(t, 1, result["seq"])
	assert.Equal(t, false, result["compact"])
	event := ts.publisher.Last()
	assert.Equal(t, EventUpdate, event.Event)
	assert.Equal(t, channelID, event.Broadcast.ChannelId)
	assert.Equal(t, docID, event.Payload["doc_id"])
	assert.Equal(t, "c-1", event.Payload["client_id"])
	assert.EqualValues(t, 1, event.Payload["seq"])
	assert.Equal(t, b64("u1"), event.Payload["data"])

	w, _ = ts.do(t, bob, http.MethodPost, "/docs/"+docID+"/updates", map[string]any{"client_id": "c-2", "data": b64("u2")})
	assert.Equal(t, http.StatusForbidden, w.Code)
	w, _ = ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/updates", map[string]any{"client_id": "bad id!", "data": b64("u2")})
	assert.Equal(t, http.StatusBadRequest, w.Code)
	w, _ = ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/updates", map[string]any{"client_id": "c-1", "data": b64(strings.Repeat("x", 2000))})
	assert.Equal(t, http.StatusRequestEntityTooLarge, w.Code)

	w, result = ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/updates", map[string]any{"client_id": "c-1", "data": b64("u2")})
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, true, result["compact"])

	// Readers load the state and catch up
	w, state := ts.do(t, bob, http.MethodGet, "/docs/"+docID+"/state", nil)
	require.Equal(t, http.StatusOK, w.Code)
	assert.EqualValues(t, 2, state["last_seq"])
	assert.Len(t, state["updates"], 2)

	w, since := ts.do(t, bob, http.MethodGet, "/docs/"+docID+"/updates?after=1", nil)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, false, since["reset"])
	assert.Len(t, since["updates"], 1)

	// Snapshots from editors only
	w, _ = ts.do(t, bob, http.MethodPut, "/docs/"+docID+"/snapshot", map[string]any{"seq": 2, "data": b64("s2")})
	assert.Equal(t, http.StatusForbidden, w.Code)
	w, _ = ts.do(t, alice, http.MethodPut, "/docs/"+docID+"/snapshot", map[string]any{"seq": 2, "data": b64("s2")})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	w, _ = ts.do(t, alice, http.MethodPut, "/docs/"+docID+"/snapshot", map[string]any{"seq": 1, "data": b64("s1")})
	assert.Equal(t, http.StatusConflict, w.Code)

	w, since = ts.do(t, bob, http.MethodGet, "/docs/"+docID+"/updates?after=1", nil)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, true, since["reset"])

	// Readers' presence is relayed too
	w, _ = ts.do(t, bob, http.MethodPost, "/docs/"+docID+"/awareness", map[string]any{"client_id": "c-2", "data": b64("cursor")})
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, EventAwareness, ts.publisher.Last().Event)
	assert.Equal(t, b64("cursor"), ts.publisher.Last().Payload["data"])

	// Renaming
	w, renamed := ts.do(t, alice, http.MethodPatch, "/docs/"+docID, map[string]any{"title": ""})
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "Untitled", renamed["title"])
	assert.Equal(t, EventDocUpdated, ts.publisher.Last().Event)

	// Only the creator and channel admins delete
	ts.access.set(bob, channelID, ReadWrite)
	w, _ = ts.do(t, bob, http.MethodDelete, "/docs/"+docID, nil)
	assert.Equal(t, http.StatusForbidden, w.Code)
	ts.access.admins[bob+"/"+channelID] = true
	var deleted *Doc
	ts.OnDelete = func(doc *Doc) error {
		deleted = doc
		return nil
	}
	w, _ = ts.do(t, bob, http.MethodDelete, "/docs/"+docID, nil)
	require.Equal(t, http.StatusOK, w.Code)
	require.NotNil(t, deleted)
	assert.Equal(t, docID, deleted.ID)
	assert.Equal(t, EventDocDeleted, ts.publisher.Last().Event)
	assert.Empty(t, ts.kv.Keys(""))
}

func TestAPIPersonalDocument(t *testing.T) {
	ts := newTestService(LogOptions{})
	alice, bob := model.NewId(), model.NewId()

	w, created := ts.do(t, alice, http.MethodPost, "/docs", map[string]any{"content": b64("initial")})
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	docID := created["id"].(string)
	assert.Equal(t, "Untitled", created["title"])
	assert.Equal(t, alice, created["owner_id"])
	assert.Equal(t, alice, ts.publisher.Last().Broadcast.UserId)

	w, state := ts.do(t, alice, http.MethodGet, "/docs/"+docID+"/state", nil)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, b64("initial"), state["snapshot"])

	// Invisible to others
	w, _ = ts.do(t, bob, http.MethodGet, "/docs/"+docID, nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
	w, _ = ts.do(t, bob, http.MethodPost, "/docs/"+docID+"/updates", map[string]any{"client_id": "c", "data": b64("u")})
	assert.Equal(t, http.StatusNotFound, w.Code)

	w, _ = ts.do(t, bob, http.MethodGet, "/docs", nil)
	require.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, "[]", w.Body.String())

	w, _ = ts.do(t, alice, http.MethodGet, "/docs", nil)
	require.Equal(t, http.StatusOK, w.Code)
	var list []map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &list))
	assert.Len(t, list, 1)

	// Large updates aren't sent in the events
	ts.Hub.InlineLimit = 4
	w, _ = ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/updates", map[string]any{"client_id": "c", "data": b64("12345")})
	require.Equal(t, http.StatusOK, w.Code)
	_, inline := ts.publisher.Last().Payload["data"]
	assert.False(t, inline)
	assert.Equal(t, alice, ts.publisher.Last().Broadcast.UserId)
}

func TestAPIServerMerge(t *testing.T) {
	ts := newTestService(LogOptions{Merge: func(s []byte, u [][]byte) ([]byte, error) { return s, nil }})
	alice := model.NewId()
	_, created := ts.do(t, alice, http.MethodPost, "/docs", map[string]any{})
	w, _ := ts.do(t, alice, http.MethodPut, "/docs/"+created["id"].(string)+"/snapshot", map[string]any{"seq": 1, "data": b64("s")})
	assert.Equal(t, http.StatusMethodNotAllowed, w.Code)
}

func TestAPIValidateUpdate(t *testing.T) {
	ts := newTestService(LogOptions{})
	ts.ValidateUpdate = func(data []byte) error {
		if !json.Valid(data) {
			return assert.AnError
		}
		return nil
	}
	alice := model.NewId()
	w, _ := ts.do(t, alice, http.MethodPost, "/docs", map[string]any{"content": b64("not json")})
	assert.Equal(t, http.StatusBadRequest, w.Code)
	w, created := ts.do(t, alice, http.MethodPost, "/docs", map[string]any{"content": b64(`{"elements":[]}`)})
	require.Equal(t, http.StatusCreated, w.Code)
	w, _ = ts.do(t, alice, http.MethodPost, "/docs/"+created["id"].(string)+"/updates", map[string]any{"client_id": "c", "data": b64("{")})
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAPIVersions(t *testing.T) {
	ts := newTestService(LogOptions{KeepVersions: 5})
	alice := model.NewId()
	_, created := ts.do(t, alice, http.MethodPost, "/docs", map[string]any{})
	docID := created["id"].(string)

	for i, snapshot := range []string{"s1", "s2"} {
		ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/updates", map[string]any{"client_id": "c", "data": b64("u")})
		w, _ := ts.do(t, alice, http.MethodPut, "/docs/"+docID+"/snapshot", map[string]any{"seq": i + 1, "data": b64(snapshot)})
		require.Equal(t, http.StatusOK, w.Code)
	}

	w, _ := ts.do(t, alice, http.MethodGet, "/docs/"+docID+"/versions", nil)
	require.Equal(t, http.StatusOK, w.Code)
	var versions []map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &versions))
	require.Len(t, versions, 1)
	assert.EqualValues(t, 1, versions[0]["seq"])

	w, version := ts.do(t, alice, http.MethodGet, "/docs/"+docID+"/versions/1", nil)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, b64("s1"), version["data"])

	w, _ = ts.do(t, alice, http.MethodGet, "/docs/"+docID+"/versions/2", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}
