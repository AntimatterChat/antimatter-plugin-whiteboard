// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
)

const (
	// MaxTitleLength is the maximum length of a document title, in characters.
	MaxTitleLength = 200

	// touchInterval is how often the update time of a document is saved while it's edited.
	touchInterval = 30 * time.Second
)

var clientIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// Logger logs the failed requests (implemented by plugin.API).
type Logger interface {
	LogError(msg string, keyValuePairs ...any)
}

// Service serves the REST API of the documents: their registry, their content, and the relay of
// their updates and of the presence of their editors.
type Service struct {
	Docs   *DocStore
	Log    *Log
	Hub    *Hub
	Access Access
	Logger Logger

	// DefaultTitle is the title of the documents created without one.
	DefaultTitle string

	// Size limits of the updates (and of the initial content), snapshots and awareness messages.
	MaxUpdateBytes    int
	MaxSnapshotBytes  int
	MaxAwarenessBytes int

	// ValidateUpdate, if set, rejects malformed updates and initial contents.
	ValidateUpdate func(data []byte) error

	// OnDelete, if set, removes what the plugin keeps about a deleted document.
	OnDelete func(doc *Doc) error

	// Now returns the current time (time.Now if nil).
	Now func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Error is an error with an HTTP status.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string {
	return e.Message
}

func NewError(status int, message string) *Error {
	return &Error{Status: status, Message: message}
}

var (
	errNotFound  = NewError(http.StatusNotFound, "document not found")
	errForbidden = NewError(http.StatusForbidden, "you can't edit this document")
)

// UserID returns the ID of the user making the request, set by the server.
func UserID(r *http.Request) string {
	return r.Header.Get("Mattermost-User-Id")
}

// WriteJSON writes a JSON response.
func WriteJSON(w http.ResponseWriter, v any) {
	WriteJSONStatus(w, http.StatusOK, v)
}

// WriteJSONStatus writes a JSON response with the given status.
func WriteJSONStatus(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError writes the error as a JSON response, logging internal errors.
func (s *Service) WriteError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	message := "internal error"
	var apiErr *Error
	var appErr *model.AppError
	switch {
	case errors.As(err, &apiErr):
		status, message = apiErr.Status, apiErr.Message
	case errors.Is(err, ErrStaleSnapshot), errors.Is(err, ErrInvalidSnapshot):
		status, message = http.StatusConflict, err.Error()
	case errors.Is(err, ErrTooManyDocs):
		status, message = http.StatusBadRequest, err.Error()
	case errors.As(err, &appErr) && appErr.StatusCode < http.StatusInternalServerError && appErr.StatusCode >= http.StatusBadRequest:
		status, message = appErr.StatusCode, appErr.Message
	}
	if status >= http.StatusInternalServerError && s.Logger != nil {
		s.Logger.LogError("Document request failed", "err", err.Error())
	}
	WriteJSONStatus(w, status, map[string]string{"error": message})
}

// ReadJSON decodes a JSON request body of at most maxBytes of binary data.
func ReadJSON(w http.ResponseWriter, r *http.Request, maxBytes int, v any) error {
	// Base64 makes binary data a third larger
	limit := int64(maxBytes)*4/3 + 4096
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit)).Decode(v); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return NewError(http.StatusRequestEntityTooLarge, "request too large")
		}
		return NewError(http.StatusBadRequest, "invalid request body")
	}
	return nil
}

// RegisterRoutes adds the routes of the API, under /docs, to the router.
func (s *Service) RegisterRoutes(router *mux.Router) {
	router.HandleFunc("/docs", s.handleList).Methods(http.MethodGet)
	router.HandleFunc("/docs", s.handleCreate).Methods(http.MethodPost)

	doc := router.PathPrefix("/docs/{doc_id:[a-z0-9]{26}}").Subrouter()
	doc.HandleFunc("", s.handleGet).Methods(http.MethodGet)
	doc.HandleFunc("", s.handleRename).Methods(http.MethodPatch)
	doc.HandleFunc("", s.handleDelete).Methods(http.MethodDelete)
	doc.HandleFunc("/state", s.handleState).Methods(http.MethodGet)
	doc.HandleFunc("/updates", s.handleSince).Methods(http.MethodGet)
	doc.HandleFunc("/updates", s.handleAppend).Methods(http.MethodPost)
	doc.HandleFunc("/snapshot", s.handleSnapshot).Methods(http.MethodPut)
	doc.HandleFunc("/awareness", s.handleAwareness).Methods(http.MethodPost)
	doc.HandleFunc("/versions", s.handleVersions).Methods(http.MethodGet)
	doc.HandleFunc("/versions/{seq:[0-9]+}", s.handleVersion).Methods(http.MethodGet)
}

// DocPermission returns what the user can do with the document.
func (s *Service) DocPermission(userID string, doc *Doc) (Permission, error) {
	if doc.IsPersonal() {
		if doc.OwnerID == userID {
			return ReadWrite, nil
		}
		return NoAccess, nil
	}
	return s.Access.ChannelPermission(userID, doc.ChannelID)
}

// RequestDoc returns the document of the request if the user can read it, or edit it when write
// is true.
func (s *Service) RequestDoc(r *http.Request, write bool) (*Doc, error) {
	doc, err := s.Docs.Get(mux.Vars(r)["doc_id"])
	if err != nil {
		return nil, err
	}
	if doc == nil {
		return nil, errNotFound
	}

	permission, err := s.DocPermission(UserID(r), doc)
	if err != nil {
		return nil, err
	}
	switch {
	case permission == NoAccess:
		// Don't tell whether documents the user can't see exist
		return nil, errNotFound
	case write && permission != ReadWrite:
		return nil, errForbidden
	}
	return doc, nil
}

func normalizeTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	if utf8.RuneCountInString(title) > MaxTitleLength {
		return "", NewError(http.StatusBadRequest, "the title is too long")
	}
	return title, nil
}

// DocResponse is a document with what the requesting user can do with it.
type DocResponse struct {
	*Doc
	CanEdit   bool `json:"can_edit"`
	CanDelete bool `json:"can_delete"`
}

func (s *Service) docResponse(userID string, doc *Doc, permission Permission) DocResponse {
	canDelete := permission == ReadWrite && (doc.IsPersonal() || doc.CreatorID == userID || s.Access.CanManageChannel(userID, doc.ChannelID))
	return DocResponse{Doc: doc, CanEdit: permission == ReadWrite, CanDelete: canDelete}
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	userID := UserID(r)
	channelID := r.URL.Query().Get("channel_id")

	var docs []*Doc
	permission := ReadWrite
	var err error
	if channelID == "" {
		docs, err = s.Docs.ListPersonal(userID)
	} else {
		if !model.IsValidId(channelID) {
			s.WriteError(w, NewError(http.StatusBadRequest, "invalid channel_id"))
			return
		}
		if permission, err = s.Access.ChannelPermission(userID, channelID); err == nil && permission == NoAccess {
			err = NewError(http.StatusForbidden, "you don't have access to this channel")
		}
		if err == nil {
			docs, err = s.Docs.ListChannel(channelID)
		}
	}
	if err != nil {
		s.WriteError(w, err)
		return
	}

	response := make([]DocResponse, 0, len(docs))
	for _, doc := range docs {
		response = append(response, s.docResponse(userID, doc, permission))
	}
	WriteJSON(w, response)
}

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title     string `json:"title"`
		ChannelID string `json:"channel_id"`
		Content   []byte `json:"content"`
	}
	if err := ReadJSON(w, r, s.MaxSnapshotBytes, &body); err != nil {
		s.WriteError(w, err)
		return
	}

	title, err := normalizeTitle(body.Title)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	if title == "" {
		title = s.DefaultTitle
	}
	if len(body.Content) > 0 && s.ValidateUpdate != nil {
		if err = s.ValidateUpdate(body.Content); err != nil {
			s.WriteError(w, NewError(http.StatusBadRequest, "invalid content: "+err.Error()))
			return
		}
	}

	userID := UserID(r)
	now := s.now().UnixMilli()
	doc := &Doc{ID: model.NewId(), Title: title, CreatorID: userID, CreateAt: now, UpdateAt: now, UpdatedBy: userID}
	if body.ChannelID == "" {
		doc.OwnerID = userID
	} else {
		if !model.IsValidId(body.ChannelID) {
			s.WriteError(w, NewError(http.StatusBadRequest, "invalid channel_id"))
			return
		}
		permission, err := s.Access.ChannelPermission(userID, body.ChannelID)
		if err != nil {
			s.WriteError(w, err)
			return
		}
		if permission != ReadWrite {
			s.WriteError(w, NewError(http.StatusForbidden, "you can't add documents to this channel"))
			return
		}
		doc.ChannelID = body.ChannelID
	}

	// The content first: a listed document can always be opened
	if len(body.Content) > 0 {
		if err = s.Log.Init(doc.ID, body.Content); err != nil {
			s.WriteError(w, err)
			return
		}
	}
	if err = s.Docs.Create(doc); err != nil {
		_ = s.Log.Delete(doc.ID)
		s.WriteError(w, err)
		return
	}

	s.Hub.DocChanged(EventDocCreated, doc)
	WriteJSONStatus(w, http.StatusCreated, s.docResponse(userID, doc, ReadWrite))
}

func (s *Service) handleGet(w http.ResponseWriter, r *http.Request) {
	doc, err := s.RequestDoc(r, false)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	permission, err := s.DocPermission(UserID(r), doc)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	WriteJSON(w, s.docResponse(UserID(r), doc, permission))
}

func (s *Service) handleRename(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title *string `json:"title"`
	}
	if err := ReadJSON(w, r, 4096, &body); err != nil {
		s.WriteError(w, err)
		return
	}
	if body.Title == nil {
		s.WriteError(w, NewError(http.StatusBadRequest, `invalid request body, expected {"title": "..."}`))
		return
	}
	title, err := normalizeTitle(*body.Title)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	if title == "" {
		title = s.DefaultTitle
	}

	doc, err := s.RequestDoc(r, true)
	if err != nil {
		s.WriteError(w, err)
		return
	}

	userID := UserID(r)
	doc, err = s.Docs.Update(doc.ID, func(d *Doc) bool {
		d.Title = title
		d.UpdateAt = s.now().UnixMilli()
		d.UpdatedBy = userID
		return true
	})
	if err != nil {
		s.WriteError(w, err)
		return
	}
	if doc == nil {
		s.WriteError(w, errNotFound)
		return
	}

	s.Hub.DocChanged(EventDocUpdated, doc)
	WriteJSON(w, s.docResponse(userID, doc, ReadWrite))
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	doc, err := s.RequestDoc(r, true)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	if !s.docResponse(UserID(r), doc, ReadWrite).CanDelete {
		s.WriteError(w, NewError(http.StatusForbidden, "only its creator and the channel admins can delete this document"))
		return
	}

	if err = s.Docs.Delete(doc); err != nil {
		s.WriteError(w, err)
		return
	}
	if err = s.Log.Delete(doc.ID); err != nil {
		s.WriteError(w, err)
		return
	}
	if s.OnDelete != nil {
		if err = s.OnDelete(doc); err != nil {
			s.WriteError(w, err)
			return
		}
	}

	s.Hub.DocChanged(EventDocDeleted, doc)
	WriteJSON(w, map[string]string{"status": "OK"})
}

func (s *Service) handleState(w http.ResponseWriter, r *http.Request) {
	doc, err := s.RequestDoc(r, false)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	state, err := s.Log.Load(doc.ID)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	WriteJSON(w, state)
}

func (s *Service) handleSince(w http.ResponseWriter, r *http.Request) {
	after, err := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	if err != nil || after < 0 {
		s.WriteError(w, NewError(http.StatusBadRequest, "invalid after"))
		return
	}

	doc, err := s.RequestDoc(r, false)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	updates, reset, err := s.Log.Since(doc.ID, after)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	if updates == nil {
		updates = []Update{}
	}
	WriteJSON(w, map[string]any{"updates": updates, "reset": reset})
}

func (s *Service) handleAppend(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ClientID string `json:"client_id"`
		Data     []byte `json:"data"`
	}
	if err := ReadJSON(w, r, s.MaxUpdateBytes, &body); err != nil {
		s.WriteError(w, err)
		return
	}
	if !clientIDPattern.MatchString(body.ClientID) || len(body.Data) == 0 {
		s.WriteError(w, NewError(http.StatusBadRequest, `invalid request body, expected {"client_id": "...", "data": "<base64>"}`))
		return
	}
	if len(body.Data) > s.MaxUpdateBytes {
		s.WriteError(w, NewError(http.StatusRequestEntityTooLarge, "update too large"))
		return
	}
	if s.ValidateUpdate != nil {
		if err := s.ValidateUpdate(body.Data); err != nil {
			s.WriteError(w, NewError(http.StatusBadRequest, "invalid update: "+err.Error()))
			return
		}
	}

	doc, err := s.RequestDoc(r, true)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	result, err := s.Log.Append(doc.ID, body.Data)
	if result == nil {
		s.WriteError(w, err)
		return
	}
	if err != nil && s.Logger != nil {
		// The update is stored, only the compaction failed
		s.Logger.LogError("Failed to compact a document", "doc_id", doc.ID, "err", err.Error())
	}

	s.Hub.Update(doc, body.ClientID, result.Seq, body.Data)
	s.touch(doc, UserID(r))
	WriteJSON(w, result)
}

// touch saves when and by whom a document was edited, at most every touchInterval.
func (s *Service) touch(doc *Doc, userID string) {
	now := s.now()
	if doc.UpdatedBy == userID && now.Sub(time.UnixMilli(doc.UpdateAt)) < touchInterval {
		return
	}
	_, err := s.Docs.Update(doc.ID, func(d *Doc) bool {
		d.UpdateAt = now.UnixMilli()
		d.UpdatedBy = userID
		return true
	})
	if err != nil && s.Logger != nil {
		s.Logger.LogError("Failed to save the update time of a document", "doc_id", doc.ID, "err", err.Error())
	}
}

func (s *Service) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	if s.Log.ServerMerges() {
		s.WriteError(w, NewError(http.StatusMethodNotAllowed, "the server compacts this document itself"))
		return
	}

	var body struct {
		Seq  int64  `json:"seq"`
		Data []byte `json:"data"`
	}
	if err := ReadJSON(w, r, s.MaxSnapshotBytes, &body); err != nil {
		s.WriteError(w, err)
		return
	}
	if body.Seq <= 0 || len(body.Data) == 0 {
		s.WriteError(w, NewError(http.StatusBadRequest, `invalid request body, expected {"seq": n, "data": "<base64>"}`))
		return
	}
	if len(body.Data) > s.MaxSnapshotBytes {
		s.WriteError(w, NewError(http.StatusRequestEntityTooLarge, "snapshot too large"))
		return
	}

	doc, err := s.RequestDoc(r, true)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	if err = s.Log.Compact(doc.ID, body.Data, body.Seq); err != nil {
		s.WriteError(w, err)
		return
	}
	WriteJSON(w, map[string]string{"status": "OK"})
}

func (s *Service) handleAwareness(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ClientID string `json:"client_id"`
		Data     []byte `json:"data"`
	}
	if err := ReadJSON(w, r, s.MaxAwarenessBytes, &body); err != nil {
		s.WriteError(w, err)
		return
	}
	if !clientIDPattern.MatchString(body.ClientID) || len(body.Data) == 0 || len(body.Data) > s.MaxAwarenessBytes {
		s.WriteError(w, NewError(http.StatusBadRequest, `invalid request body, expected {"client_id": "...", "data": "<base64>"}`))
		return
	}

	// Readers are shown as present too
	doc, err := s.RequestDoc(r, false)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	s.Hub.Awareness(doc, body.ClientID, body.Data)
	WriteJSON(w, map[string]string{"status": "OK"})
}

func (s *Service) handleVersions(w http.ResponseWriter, r *http.Request) {
	doc, err := s.RequestDoc(r, false)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	versions, err := s.Log.Versions(doc.ID)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	WriteJSON(w, versions)
}

func (s *Service) handleVersion(w http.ResponseWriter, r *http.Request) {
	seq, err := strconv.ParseInt(mux.Vars(r)["seq"], 10, 64)
	if err != nil {
		s.WriteError(w, NewError(http.StatusBadRequest, "invalid version"))
		return
	}

	doc, err := s.RequestDoc(r, false)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	data, err := s.Log.Version(doc.ID, seq)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	if data == nil {
		s.WriteError(w, NewError(http.StatusNotFound, "version not found"))
		return
	}
	WriteJSON(w, map[string]any{"seq": seq, "data": data})
}
