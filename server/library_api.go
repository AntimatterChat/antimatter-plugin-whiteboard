// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"bytes"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"

	"github.com/antimatterchat/antimatter-plugin-whiteboard/server/relay"
)

// libraryAPI is the part of the plugin API used to check who sees and manages the libraries, and to
// log their changes.
type libraryAPI interface {
	GetTeamMember(teamID, userID string) (*model.TeamMember, *model.AppError)
	GetChannel(channelID string) (*model.Channel, *model.AppError)
	HasPermissionTo(userID string, permission *model.Permission) bool
	HasPermissionToTeam(userID, teamID string, permission *model.Permission) bool
	LogInfo(msg string, keyValuePairs ...any)
	LogWarn(msg string, keyValuePairs ...any)
	LogAuditRec(rec *model.AuditRecord)
}

// LibrariesResponse lists the libraries of a community: the server's and the team's.
type LibrariesResponse struct {
	TeamID          string     `json:"team_id"`
	CanManageTeam   bool       `json:"can_manage_team"`
	CanManageServer bool       `json:"can_manage_server"`
	Libraries       []*Library `json:"libraries"`
}

var (
	errLibraryNotFound  = relay.NewError(http.StatusNotFound, "library not found")
	errLibraryForbidden = relay.NewError(http.StatusForbidden, "only the admins of the community, or of the server, can change its libraries")
)

func (p *Plugin) registerLibraryRoutes(api *mux.Router) {
	api.HandleFunc("/libraries", p.handleListLibraries).Methods(http.MethodGet)
	api.HandleFunc("/libraries", p.handleUploadLibrary).Methods(http.MethodPost)
	library := api.PathPrefix("/libraries/{library_id:[a-z0-9]{26}}").Subrouter()
	library.HandleFunc("/items", p.handleLibraryItems).Methods(http.MethodGet)
	library.HandleFunc("", p.handleRenameLibrary).Methods(http.MethodPatch)
	library.HandleFunc("", p.handleDeleteLibrary).Methods(http.MethodDelete)
}

func (p *Plugin) isSystemAdmin(userID string) bool {
	return p.libraryAPI.HasPermissionTo(userID, model.PermissionManageSystem)
}

// canSeeTeam returns whether a user sees the libraries of a team: its members do, and the system admins.
func (p *Plugin) canSeeTeam(userID, teamID string) bool {
	if member, appErr := p.libraryAPI.GetTeamMember(teamID, userID); appErr == nil && member != nil && member.DeleteAt == 0 {
		return true
	}
	return p.isSystemAdmin(userID)
}

// canManageLibraries returns whether a user adds, renames and deletes the libraries of the server
// (teamID empty: its system admins) or of a team (its admins, and the system admins).
func (p *Plugin) canManageLibraries(userID, teamID string) bool {
	if teamID == "" {
		return p.isSystemAdmin(userID)
	}
	return p.libraryAPI.HasPermissionToTeam(userID, teamID, model.PermissionManageTeam) || p.isSystemAdmin(userID)
}

// requestTeam returns the community of a request: the team of its channel_id (one the user is a
// member of), or its team_id for the channels without a team (direct and group messages), and the
// personal boards. Empty means the server's libraries only.
func (p *Plugin) requestTeam(r *http.Request, userID string) (string, error) {
	teamID := r.URL.Query().Get("team_id")
	if channelID := r.URL.Query().Get("channel_id"); channelID != "" {
		if !model.IsValidId(channelID) {
			return "", relay.NewError(http.StatusBadRequest, "invalid channel id")
		}
		permission, err := p.service.Access.ChannelPermission(userID, channelID)
		if err != nil {
			return "", err
		}
		if permission == relay.NoAccess {
			return "", relay.NewError(http.StatusNotFound, "channel not found")
		}
		channel, appErr := p.libraryAPI.GetChannel(channelID)
		if appErr != nil {
			return "", appErr
		}
		if channel.TeamId != "" {
			teamID = channel.TeamId
		}
	}
	if teamID != "" && !model.IsValidId(teamID) {
		return "", relay.NewError(http.StatusBadRequest, "invalid team id")
	}
	if teamID != "" && !p.canSeeTeam(userID, teamID) {
		return "", relay.NewError(http.StatusForbidden, "you are not a member of this community")
	}
	return teamID, nil
}

// handleListLibraries lists the libraries of the server, and of a community.
func (p *Plugin) handleListLibraries(w http.ResponseWriter, r *http.Request) {
	userID := relay.UserID(r)
	teamID, err := p.requestTeam(r, userID)
	if err != nil {
		p.service.WriteError(w, err)
		return
	}

	libraries, err := p.libraries.List("")
	if err != nil {
		p.service.WriteError(w, err)
		return
	}
	if teamID != "" {
		teamLibraries, err := p.libraries.List(teamID)
		if err != nil {
			p.service.WriteError(w, err)
			return
		}
		libraries = append(libraries, teamLibraries...)
	}
	relay.WriteJSON(w, LibrariesResponse{
		TeamID:          teamID,
		CanManageTeam:   teamID != "" && p.canManageLibraries(userID, teamID),
		CanManageServer: p.isSystemAdmin(userID),
		Libraries:       libraries,
	})
}

// handleLibraryItems returns the items of a library, as an .excalidrawlib file.
func (p *Plugin) handleLibraryItems(w http.ResponseWriter, r *http.Request) {
	userID := relay.UserID(r)
	libraryID := mux.Vars(r)["library_id"]
	teamID, ok, err := p.libraries.Scope(libraryID)
	if err != nil {
		p.service.WriteError(w, err)
		return
	}
	if !ok || (teamID != "" && !p.canSeeTeam(userID, teamID)) {
		p.service.WriteError(w, errLibraryNotFound)
		return
	}
	items, err := p.libraries.Items(libraryID)
	if err != nil {
		p.service.WriteError(w, err)
		return
	}
	if items == nil {
		p.service.WriteError(w, errLibraryNotFound)
		return
	}

	// The items of a library never change: renaming it changes its name only
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	var body bytes.Buffer
	body.WriteString(`{"type":"excalidrawlib","version":2,"source":"antimatter","libraryItems":`)
	body.Write(items)
	body.WriteString("}\n")
	_, _ = w.Write(body.Bytes())
}

// libraryName returns the name of an uploaded library: the one given, or its file's name.
func libraryName(name, filename string) string {
	if strings.TrimSpace(name) == "" {
		name = strings.TrimSuffix(path.Base(strings.ReplaceAll(filename, "\\", "/")), path.Ext(filename))
	}
	return cleanName(name, maxLibraryNameLength)
}

// readLibraryUpload reads the multipart form of an upload: the .excalidrawlib file, its name and
// its community.
func readLibraryUpload(w http.ResponseWriter, r *http.Request) (data []byte, name, teamID string, err error) {
	// The file, and a little room for the other fields
	r.Body = http.MaxBytesReader(w, r.Body, maxLibraryFileBytes+64*1024)
	reader, err := r.MultipartReader()
	if err != nil {
		return nil, "", "", relay.NewError(http.StatusBadRequest, "send the library as a multipart form")
	}
	var filename string
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, "", "", tooLargeOr(err, "invalid form")
		}
		switch part.FormName() {
		case "file":
			filename = part.FileName()
			data, err = readPart(part, maxLibraryFileBytes)
		case "name":
			var v []byte
			v, err = readPart(part, 1024)
			name = string(v)
		case "team_id":
			var v []byte
			v, err = readPart(part, 64)
			teamID = strings.TrimSpace(string(v))
		}
		_ = part.Close()
		if err != nil {
			return nil, "", "", err
		}
	}
	if data == nil {
		return nil, "", "", relay.NewError(http.StatusBadRequest, "add an .excalidrawlib file")
	}
	return data, libraryName(name, filename), teamID, nil
}

func readPart(part *multipart.Part, maxBytes int) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(part, int64(maxBytes)+1))
	if err != nil {
		return nil, tooLargeOr(err, "invalid form")
	}
	if len(data) > maxBytes {
		return nil, relay.NewError(http.StatusRequestEntityTooLarge, "the library is too large (5 MB at most)")
	}
	return data, nil
}

func tooLargeOr(err error, message string) error {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return relay.NewError(http.StatusRequestEntityTooLarge, "the library is too large (5 MB at most)")
	}
	return relay.NewError(http.StatusBadRequest, message)
}

// libraryAudit returns an audit record of a change to the libraries, by a user.
func libraryAudit(event, userID string, r *http.Request) *model.AuditRecord {
	return &model.AuditRecord{
		EventName: "whiteboard." + event,
		Status:    model.AuditStatusAttempt,
		Actor: model.AuditEventActor{
			UserId:        userID,
			SessionId:     r.Header.Get("Mattermost-Session-Id"),
			Client:        r.UserAgent(),
			IpAddress:     r.RemoteAddr,
			XForwardedFor: r.Header.Get("X-Forwarded-For"),
		},
		Meta: map[string]any{model.AuditKeyAPIPath: r.URL.Path},
	}
}

// auditFail records a refused or failed change to the libraries.
func (p *Plugin) auditFail(rec *model.AuditRecord, err error) {
	rec.Fail()
	var apiErr *relay.Error
	if errors.As(err, &apiErr) {
		rec.AddErrorCode(apiErr.Status)
		rec.AddErrorDesc(apiErr.Message)
		if apiErr.Status == http.StatusForbidden {
			p.libraryAPI.LogWarn("Refused a change to the whiteboard libraries", "event", rec.EventName, "user_id", rec.Actor.UserId, "params", rec.EventData.Parameters)
		}
	} else {
		rec.AddErrorDesc(err.Error())
	}
	p.libraryAPI.LogAuditRec(rec)
}

// handleUploadLibrary adds a library from an .excalidrawlib file, to the server (no team_id) or to
// a community.
func (p *Plugin) handleUploadLibrary(w http.ResponseWriter, r *http.Request) {
	userID := relay.UserID(r)
	rec := libraryAudit("uploadLibrary", userID, r)
	fail := func(err error) {
		p.auditFail(rec, err)
		p.service.WriteError(w, err)
	}

	data, name, teamID, err := readLibraryUpload(w, r)
	model.AddEventParameterToAuditRec(rec, "team_id", teamID)
	model.AddEventParameterToAuditRec(rec, "name", name)
	if err != nil {
		fail(err)
		return
	}
	if teamID != "" && !model.IsValidId(teamID) {
		fail(relay.NewError(http.StatusBadRequest, "invalid team id"))
		return
	}
	if !p.canManageLibraries(userID, teamID) {
		fail(errLibraryForbidden)
		return
	}
	if name == "" {
		fail(relay.NewError(http.StatusBadRequest, "give the library a name"))
		return
	}

	now := time.Now().UnixMilli()
	library := &Library{ID: model.NewId(), Name: name, TeamID: teamID, CreatorID: userID, CreateAt: now, UpdateAt: now}
	items, skipped, err := parseLibrary(data, library.ID, now)
	if err != nil {
		fail(err)
		return
	}
	if err := p.libraries.Add(library, items); err != nil {
		fail(err)
		return
	}

	rec.AddEventResultState(library)
	rec.AddEventObjectType("whiteboard_library")
	rec.Success()
	p.libraryAPI.LogAuditRec(rec)
	p.libraryAPI.LogInfo("Whiteboard library added", "library_id", library.ID, "name", library.Name, "team_id", teamID, "user_id", userID, "items", library.ItemCount, "skipped_items", skipped, "bytes", library.Size)
	relay.WriteJSONStatus(w, http.StatusCreated, map[string]any{"library": library, "skipped_items": skipped})
}

// requestLibrary returns the team of the library of a request that the user manages.
func (p *Plugin) requestLibrary(r *http.Request, userID string) (string, string, error) {
	libraryID := mux.Vars(r)["library_id"]
	teamID, ok, err := p.libraries.Scope(libraryID)
	if err != nil {
		return "", "", err
	}
	if !ok || (teamID != "" && !p.canSeeTeam(userID, teamID)) {
		return "", "", errLibraryNotFound
	}
	if !p.canManageLibraries(userID, teamID) {
		return "", "", errLibraryForbidden
	}
	return libraryID, teamID, nil
}

// handleRenameLibrary renames a library.
func (p *Plugin) handleRenameLibrary(w http.ResponseWriter, r *http.Request) {
	userID := relay.UserID(r)
	rec := libraryAudit("renameLibrary", userID, r)
	model.AddEventParameterToAuditRec(rec, "library_id", mux.Vars(r)["library_id"])
	fail := func(err error) {
		p.auditFail(rec, err)
		p.service.WriteError(w, err)
	}

	var body struct {
		Name string `json:"name"`
	}
	if err := relay.ReadJSON(w, r, 4096, &body); err != nil {
		fail(err)
		return
	}
	name := cleanName(body.Name, maxLibraryNameLength)
	model.AddEventParameterToAuditRec(rec, "name", name)
	if name == "" {
		fail(relay.NewError(http.StatusBadRequest, "give the library a name"))
		return
	}
	libraryID, teamID, err := p.requestLibrary(r, userID)
	if err != nil {
		fail(err)
		return
	}
	library, err := p.libraries.Rename(teamID, libraryID, name, time.Now().UnixMilli())
	if err != nil {
		fail(err)
		return
	}

	rec.AddEventResultState(library)
	rec.AddEventObjectType("whiteboard_library")
	rec.Success()
	p.libraryAPI.LogAuditRec(rec)
	p.libraryAPI.LogInfo("Whiteboard library renamed", "library_id", libraryID, "name", name, "team_id", teamID, "user_id", userID)
	relay.WriteJSON(w, library)
}

// handleDeleteLibrary deletes a library.
func (p *Plugin) handleDeleteLibrary(w http.ResponseWriter, r *http.Request) {
	userID := relay.UserID(r)
	rec := libraryAudit("deleteLibrary", userID, r)
	model.AddEventParameterToAuditRec(rec, "library_id", mux.Vars(r)["library_id"])
	fail := func(err error) {
		p.auditFail(rec, err)
		p.service.WriteError(w, err)
	}

	libraryID, teamID, err := p.requestLibrary(r, userID)
	if err != nil {
		fail(err)
		return
	}
	library, err := p.libraries.Delete(teamID, libraryID)
	if err != nil {
		fail(err)
		return
	}

	rec.AddEventPriorState(library)
	rec.AddEventObjectType("whiteboard_library")
	rec.Success()
	p.libraryAPI.LogAuditRec(rec)
	p.libraryAPI.LogInfo("Whiteboard library deleted", "library_id", libraryID, "name", library.Name, "team_id", teamID, "user_id", userID)
	relay.WriteJSON(w, map[string]string{"status": "OK"})
}
