// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeLibraryAPI knows the members and admins of teams, the system admins, and records the logs.
type fakeLibraryAPI struct {
	channels   *fakeChannels
	members    map[string]bool // team/user
	teamAdmins map[string]bool // team/user
	sysAdmins  map[string]bool
	audits     []*model.AuditRecord
	infos      []string
	warnings   []string
}

func (f *fakeLibraryAPI) GetTeamMember(teamID, userID string) (*model.TeamMember, *model.AppError) {
	if !f.members[teamID+"/"+userID] {
		return nil, model.NewAppError("GetTeamMember", "not_found", nil, "", http.StatusNotFound)
	}
	return &model.TeamMember{TeamId: teamID, UserId: userID}, nil
}

func (f *fakeLibraryAPI) GetChannel(channelID string) (*model.Channel, *model.AppError) {
	return f.channels.GetChannel(channelID)
}

func (f *fakeLibraryAPI) HasPermissionTo(userID string, permission *model.Permission) bool {
	return permission.Id == model.PermissionManageSystem.Id && f.sysAdmins[userID]
}

func (f *fakeLibraryAPI) HasPermissionToTeam(userID, teamID string, permission *model.Permission) bool {
	return permission.Id == model.PermissionManageTeam.Id && f.teamAdmins[teamID+"/"+userID]
}

func (f *fakeLibraryAPI) LogInfo(msg string, _ ...any)       { f.infos = append(f.infos, msg) }
func (f *fakeLibraryAPI) LogWarn(msg string, _ ...any)       { f.warnings = append(f.warnings, msg) }
func (f *fakeLibraryAPI) LogAuditRec(rec *model.AuditRecord) { f.audits = append(f.audits, rec) }

// libraryFixture is a server with two teams: alice is a member of team, bob its admin, carol the
// admin of other, root a system admin; the channel is in team.
type libraryFixture struct {
	p                            *Plugin
	api                          *fakeLibraryAPI
	team, other                  string
	alice, bob, carol, root, eve string
}

func newLibraryFixture(t *testing.T) *libraryFixture {
	f := &libraryFixture{
		team: model.NewId(), other: model.NewId(),
		alice: model.NewId(), bob: model.NewId(), carol: model.NewId(), root: model.NewId(), eve: model.NewId(),
	}
	p, _, channels, kv := newTestPlugin(t, f.alice)
	channels.channel.TeamId = f.team
	f.p = p
	f.api = &fakeLibraryAPI{
		channels: channels,
		members: map[string]bool{
			f.team + "/" + f.alice: true, f.team + "/" + f.bob: true,
			f.other + "/" + f.carol: true, f.other + "/" + f.eve: true,
		},
		teamAdmins: map[string]bool{f.team + "/" + f.bob: true, f.other + "/" + f.carol: true},
		sysAdmins:  map[string]bool{f.root: true},
	}
	p.libraries = &libraryStore{kv: kv}
	p.libraryAPI = f.api
	return f
}

func libraryJSON(t *testing.T, v any) []byte {
	data, err := json.Marshal(v)
	require.NoError(t, err)
	return data
}

// sampleLibrary is a version 2 library of two items: a rectangle, and an image with a text.
func sampleLibrary(t *testing.T) []byte {
	return libraryJSON(t, map[string]any{
		"type": "excalidrawlib", "version": 2, "source": "https://excalidraw.com",
		"libraryItems": []any{
			map[string]any{"id": "a", "status": "published", "created": 1700000000000, "name": "Box", "elements": []any{
				map[string]any{"id": "r1", "type": "rectangle", "x": 0, "y": 0, "width": 10, "height": 10, "seed": 1958205513, "link": "javascript:alert(1)"},
			}},
			map[string]any{"id": "b", "status": "unpublished", "elements": []any{
				map[string]any{"id": "i1", "type": "image", "fileId": "f"},
				map[string]any{"id": "e1", "type": "embeddable", "link": "https://example.com"},
				map[string]any{"id": "t1", "type": "text", "text": "Hi", "link": "https://example.com/doc"},
			}},
		},
	})
}

func uploadLibrary(p *Plugin, userID, teamID, name, filename string, data []byte) *httptest.ResponseRecorder {
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	if teamID != "" {
		_ = form.WriteField("team_id", teamID)
	}
	if name != "" {
		_ = form.WriteField("name", name)
	}
	part, _ := form.CreateFormFile("file", filename)
	_, _ = part.Write(data)
	_ = form.Close()

	r := httptest.NewRequest(http.MethodPost, "/api/v1/libraries", &body)
	r.Header.Set("Content-Type", form.FormDataContentType())
	r.Header.Set("Mattermost-User-Id", userID)
	w := httptest.NewRecorder()
	p.ServeHTTP(nil, w, r)
	return w
}

func uploaded(t *testing.T, w *httptest.ResponseRecorder) *Library {
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var res struct {
		Library *Library `json:"library"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &res))
	return res.Library
}

func listLibraries(t *testing.T, p *Plugin, userID, query string) (int, LibrariesResponse) {
	w := serve(p, userID, http.MethodGet, "/api/v1/libraries"+query, nil)
	var res LibrariesResponse
	if w.Code == http.StatusOK {
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &res))
	}
	return w.Code, res
}

func libraryNames(libraries []*Library) []string {
	names := []string{}
	for _, l := range libraries {
		names = append(names, l.Name)
	}
	return names
}

func TestLibraryPermissions(t *testing.T) {
	f := newLibraryFixture(t)
	p := f.p
	lib := sampleLibrary(t)

	// Members add nothing, to the server or to their team
	assert.Equal(t, http.StatusForbidden, uploadLibrary(p, f.alice, "", "", "a.excalidrawlib", lib).Code)
	assert.Equal(t, http.StatusForbidden, uploadLibrary(p, f.alice, f.team, "", "a.excalidrawlib", lib).Code)

	// Team admins add to their team only
	assert.Equal(t, http.StatusForbidden, uploadLibrary(p, f.bob, "", "", "a.excalidrawlib", lib).Code)
	assert.Equal(t, http.StatusForbidden, uploadLibrary(p, f.bob, f.other, "", "a.excalidrawlib", lib).Code)
	teamLib := uploaded(t, uploadLibrary(p, f.bob, f.team, "", "Flow charts.excalidrawlib", lib))
	assert.Equal(t, "Flow charts", teamLib.Name)
	assert.Equal(t, f.team, teamLib.TeamID)
	assert.Equal(t, 2, teamLib.ItemCount)
	otherLib := uploaded(t, uploadLibrary(p, f.carol, f.other, "Other's", "x.excalidrawlib", lib))

	// System admins add server-wide libraries, and to any team
	serverLib := uploaded(t, uploadLibrary(p, f.root, "", "Basics", "b.excalidrawlib", lib))
	assert.Empty(t, serverLib.TeamID)
	uploaded(t, uploadLibrary(p, f.root, f.team, "Root's", "c.excalidrawlib", lib))

	// Lists: the server's, and the team's for its members
	code, res := listLibraries(t, p, f.alice, "?team_id="+f.team)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, []string{"Basics", "Flow charts", "Root's"}, libraryNames(res.Libraries))
	assert.False(t, res.CanManageTeam)
	assert.False(t, res.CanManageServer)
	code, res = listLibraries(t, p, f.bob, "?team_id="+f.team)
	require.Equal(t, http.StatusOK, code)
	assert.True(t, res.CanManageTeam)
	assert.False(t, res.CanManageServer)
	code, res = listLibraries(t, p, f.alice, "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, []string{"Basics"}, libraryNames(res.Libraries))
	code, _ = listLibraries(t, p, f.alice, "?team_id="+f.other)
	assert.Equal(t, http.StatusForbidden, code)
	code, _ = listLibraries(t, p, f.alice, "?team_id=bad")
	assert.Equal(t, http.StatusBadRequest, code)
	code, res = listLibraries(t, p, f.root, "?team_id="+f.other)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, []string{"Basics", "Other's"}, libraryNames(res.Libraries))
	assert.True(t, res.CanManageTeam)
	assert.True(t, res.CanManageServer)

	// The community of a channel is its team
	code, res = listLibraries(t, p, f.alice, "?channel_id="+f.api.channels.channel.Id)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, f.team, res.TeamID)
	code, _ = listLibraries(t, p, f.carol, "?channel_id="+f.api.channels.channel.Id)
	assert.Equal(t, http.StatusNotFound, code)

	// Items: for those who see the library
	w := serve(p, f.alice, http.MethodGet, "/api/v1/libraries/"+teamLib.ID+"/items", nil)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Contains(t, w.Header().Get("Cache-Control"), "immutable")
	w = serve(p, f.carol, http.MethodGet, "/api/v1/libraries/"+teamLib.ID+"/items", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
	w = serve(p, f.carol, http.MethodGet, "/api/v1/libraries/"+serverLib.ID+"/items", nil)
	assert.Equal(t, http.StatusOK, w.Code)
	w = serve(p, f.alice, http.MethodGet, "/api/v1/libraries/"+model.NewId()+"/items", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)

	// Renaming and deleting: as adding
	rename := func(userID, id, name string) int {
		return serveJSON(p, userID, http.MethodPatch, "/api/v1/libraries/"+id, map[string]string{"name": name}).Code
	}
	remove := func(userID, id string) int {
		return serve(p, userID, http.MethodDelete, "/api/v1/libraries/"+id, nil).Code
	}
	assert.Equal(t, http.StatusForbidden, rename(f.alice, teamLib.ID, "Mine"))
	assert.Equal(t, http.StatusForbidden, remove(f.alice, teamLib.ID))
	assert.Equal(t, http.StatusForbidden, rename(f.alice, serverLib.ID, "Mine"))
	assert.Equal(t, http.StatusForbidden, remove(f.bob, serverLib.ID))
	assert.Equal(t, http.StatusNotFound, remove(f.bob, otherLib.ID))
	assert.Equal(t, http.StatusNotFound, rename(f.bob, otherLib.ID, "Mine"))
	assert.Equal(t, http.StatusBadRequest, rename(f.bob, teamLib.ID, "  "))
	assert.Equal(t, http.StatusOK, rename(f.bob, teamLib.ID, "Diagrams"))
	assert.Equal(t, http.StatusOK, rename(f.root, serverLib.ID, "Server basics"))
	assert.Equal(t, http.StatusOK, remove(f.bob, teamLib.ID))
	assert.Equal(t, http.StatusNotFound, remove(f.bob, teamLib.ID))
	assert.Equal(t, http.StatusOK, remove(f.root, otherLib.ID))

	code, res = listLibraries(t, p, f.alice, "?team_id="+f.team)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, []string{"Server basics", "Root's"}, libraryNames(res.Libraries))
	w = serve(p, f.alice, http.MethodGet, "/api/v1/libraries/"+teamLib.ID+"/items", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)

	// Every change is audited; the refused ones are logged
	require.NotEmpty(t, f.api.audits)
	assert.Equal(t, "whiteboard.uploadLibrary", f.api.audits[0].EventName)
	assert.Equal(t, model.AuditStatusFail, f.api.audits[0].Status)
	assert.Equal(t, http.StatusForbidden, f.api.audits[0].Error.Code)
	last := f.api.audits[len(f.api.audits)-1]
	assert.Equal(t, "whiteboard.deleteLibrary", last.EventName)
	assert.Equal(t, model.AuditStatusSuccess, last.Status)
	assert.Equal(t, otherLib.ID, last.EventData.PriorState["id"])
	assert.NotEmpty(t, f.api.warnings)
	assert.Contains(t, f.api.infos, "Whiteboard library added")
}

func TestLibraryItemsSanitized(t *testing.T) {
	f := newLibraryFixture(t)
	lib := uploaded(t, uploadLibrary(f.p, f.root, "", "", "s.excalidrawlib", sampleLibrary(t)))

	w := serve(f.p, f.alice, http.MethodGet, "/api/v1/libraries/"+lib.ID+"/items", nil)
	require.Equal(t, http.StatusOK, w.Code)
	var file struct {
		Type         string        `json:"type"`
		Version      int           `json:"version"`
		LibraryItems []libraryItem `json:"libraryItems"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &file))
	assert.Equal(t, "excalidrawlib", file.Type)
	assert.Equal(t, 2, file.Version)
	require.Len(t, file.LibraryItems, 2)

	box := file.LibraryItems[0]
	assert.Equal(t, "lib-"+lib.ID+"-0", box.ID)
	assert.Equal(t, "published", box.Status)
	assert.Equal(t, "Box", box.Name)
	assert.Equal(t, int64(1700000000000), box.Created)
	require.Len(t, box.Elements, 1)
	var rect map[string]any
	require.NoError(t, json.Unmarshal(box.Elements[0], &rect))
	assert.Nil(t, rect["link"], "script links are dropped")
	assert.InDelta(t, 1958205513, rect["seed"], 0)

	// The image and the embed are dropped, the text and its web link kept
	text := file.LibraryItems[1]
	require.Len(t, text.Elements, 1)
	assert.Contains(t, string(text.Elements[0]), `"type":"text"`)
	assert.Contains(t, string(text.Elements[0]), `"link":"https://example.com/doc"`)
}

func TestLibraryValidation(t *testing.T) {
	f := newLibraryFixture(t)
	upload := func(data []byte) *httptest.ResponseRecorder {
		return uploadLibrary(f.p, f.root, "", "", "x.excalidrawlib", data)
	}
	rect := map[string]any{"id": "r", "type": "rectangle"}

	cases := []struct {
		name string
		data []byte
		code int
	}{
		{"not JSON", []byte("<script>alert(1)</script>"), http.StatusBadRequest},
		{"a scene", libraryJSON(t, map[string]any{"type": "excalidraw", "version": 2, "elements": []any{rect}}), http.StatusBadRequest},
		{"unknown version", libraryJSON(t, map[string]any{"type": "excalidrawlib", "version": 3, "libraryItems": []any{}}), http.StatusBadRequest},
		{"empty", libraryJSON(t, map[string]any{"type": "excalidrawlib", "version": 2, "libraryItems": []any{}}), http.StatusBadRequest},
		{"images only", libraryJSON(t, map[string]any{"type": "excalidrawlib", "version": 2, "libraryItems": []any{
			map[string]any{"elements": []any{map[string]any{"id": "i", "type": "image"}}},
		}}), http.StatusBadRequest},
		{"element without id", libraryJSON(t, map[string]any{"type": "excalidrawlib", "version": 2, "libraryItems": []any{
			map[string]any{"elements": []any{map[string]any{"type": "rectangle"}}},
		}}), http.StatusBadRequest},
		{"item not an object", libraryJSON(t, map[string]any{"type": "excalidrawlib", "version": 2, "libraryItems": []any{"x"}}), http.StatusBadRequest},
		{"too large", append(libraryJSON(t, map[string]any{"type": "excalidrawlib", "version": 1, "library": []any{[]any{rect}}}), bytes.Repeat([]byte(" "), maxLibraryFileBytes)...), http.StatusRequestEntityTooLarge},
		{"version 1", libraryJSON(t, map[string]any{"type": "excalidrawlib", "version": 1, "library": []any{[]any{rect}, []any{rect}}}), http.StatusCreated},
		{"version 2 with lists of elements", libraryJSON(t, map[string]any{"type": "excalidrawlib", "version": 2, "libraryItems": []any{[]any{rect}}}), http.StatusCreated},
	}
	for _, c := range cases {
		w := upload(c.data)
		assert.Equal(t, c.code, w.Code, "%s: %s", c.name, w.Body.String())
	}

	// Not a multipart form, or no file
	w := serveJSON(f.p, f.root, http.MethodPost, "/api/v1/libraries", map[string]any{"type": "excalidrawlib"})
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Bad team
	w = uploadLibrary(f.p, f.root, "nope", "", "x.excalidrawlib", sampleLibrary(t))
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Nothing left behind by the refused uploads
	code, res := listLibraries(t, f.p, f.root, "")
	require.Equal(t, http.StatusOK, code)
	assert.Len(t, res.Libraries, 2)
}

func TestLibraryLimits(t *testing.T) {
	f := newLibraryFixture(t)
	small := libraryJSON(t, map[string]any{"type": "excalidrawlib", "version": 1, "library": []any{[]any{map[string]any{"id": "r", "type": "rectangle"}}}})
	for i := range maxLibrariesPerScope {
		uploaded(t, uploadLibrary(f.p, f.bob, f.team, fmt.Sprintf("L%d", i), "x.excalidrawlib", small))
	}
	w := uploadLibrary(f.p, f.bob, f.team, "One more", "x.excalidrawlib", small)
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "delete one first")

	// Other scopes have their own room
	uploaded(t, uploadLibrary(f.p, f.carol, f.other, "", "x.excalidrawlib", small))

	// The libraries of a scope are bounded in size, all together
	big := `{"type":"excalidrawlib","version":2,"libraryItems":[{"elements":[{"id":"t","type":"text","text":"` + strings.Repeat("x", maxLibraryFileBytes-200) + `"}]}]}`
	for i := range maxScopeLibraryBytes / maxLibraryFileBytes {
		uploaded(t, uploadLibrary(f.p, f.root, "", fmt.Sprintf("Big %d", i), "x.excalidrawlib", []byte(big)))
	}
	w = uploadLibrary(f.p, f.root, "", "Too much", "x.excalidrawlib", []byte(big))
	assert.Equal(t, http.StatusRequestEntityTooLarge, w.Code, w.Body.String())
}

func TestLibraryName(t *testing.T) {
	assert.Equal(t, "Flow charts", libraryName("", "C:\\Users\\me\\Flow charts.excalidrawlib"))
	assert.Equal(t, "Given", libraryName(" Given ", "file.excalidrawlib"))
	assert.Equal(t, "ab", libraryName("a\x00b\n", ""))
	assert.Len(t, []rune(libraryName(strings.Repeat("é", 300), "")), maxLibraryNameLength)
}
