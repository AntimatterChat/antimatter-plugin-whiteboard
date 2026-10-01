// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"

	"github.com/antimatterchat/antimatter-plugin-whiteboard/server/relay"
)

const (
	// boardPostType is the type of the posts sharing a board in its channel (26 characters at
	// most, the size of the column).
	boardPostType = "custom_am_whiteboard"

	maxFileBytes      = 8 * 1024 * 1024
	maxThumbnailBytes = 1024 * 1024
)

var (
	fileIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	pngSignature  = []byte("\x89PNG\r\n\x1a\n")
)

// newRouter returns the router of the plugin's REST API, served under
// /plugins/com.antimatterchat.whiteboard/api/v1.
func (p *Plugin) newRouter() *mux.Router {
	router := mux.NewRouter()
	router.Use(requireUser)

	api := router.PathPrefix("/api/v1").Subrouter()
	p.service.RegisterRoutes(api)

	board := api.PathPrefix("/docs/{doc_id:[a-z0-9]{26}}").Subrouter()
	board.HandleFunc("/share", p.handleShare).Methods(http.MethodPost)
	board.HandleFunc("/files/{file_id}", p.handleGetFile).Methods(http.MethodGet)
	board.HandleFunc("/files/{file_id}", p.handleAddFile).Methods(http.MethodPut)
	board.HandleFunc("/thumbnail", p.handleGetThumbnail).Methods(http.MethodGet)
	board.HandleFunc("/thumbnail", p.handleSetThumbnail).Methods(http.MethodPut)

	return router
}

func requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if relay.UserID(r) == "" {
			http.Error(w, "Not authorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// escapeMarkdown keeps a title from being formatted in the message of a post.
func escapeMarkdown(s string) string {
	var b strings.Builder
	for _, r := range s {
		if strings.ContainsRune("\\`*_{}[]()#+-.!|<>~", r) {
			b.WriteRune('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// handleShare posts a card linking to a board, with its thumbnail, in its channel.
func (p *Plugin) handleShare(w http.ResponseWriter, r *http.Request) {
	doc, err := p.service.RequestDoc(r, false)
	if err != nil {
		p.service.WriteError(w, err)
		return
	}
	if doc.IsPersonal() {
		p.service.WriteError(w, relay.NewError(http.StatusBadRequest, "personal boards can't be shared"))
		return
	}

	userID := relay.UserID(r)
	if !p.API.HasPermissionToChannel(userID, doc.ChannelID, model.PermissionCreatePost) {
		p.service.WriteError(w, relay.NewError(http.StatusForbidden, "you can't post in this channel"))
		return
	}

	post := &model.Post{
		UserId:    userID,
		ChannelId: doc.ChannelID,
		Message:   fmt.Sprintf("Shared a whiteboard: **%s**", escapeMarkdown(doc.Title)),
		Type:      boardPostType,
	}
	post.AddProp("doc_id", doc.ID)
	post.AddProp("title", doc.Title)

	created, appErr := p.API.CreatePost(post)
	if appErr != nil {
		p.service.WriteError(w, appErr)
		return
	}
	relay.WriteJSONStatus(w, http.StatusCreated, created)
}

func (p *Plugin) handleGetFile(w http.ResponseWriter, r *http.Request) {
	fileID := mux.Vars(r)["file_id"]
	if !fileIDPattern.MatchString(fileID) {
		p.service.WriteError(w, relay.NewError(http.StatusBadRequest, "invalid file id"))
		return
	}
	doc, err := p.service.RequestDoc(r, false)
	if err != nil {
		p.service.WriteError(w, err)
		return
	}
	file, err := p.boards.GetFile(doc.ID, fileID)
	if err != nil {
		p.service.WriteError(w, err)
		return
	}
	if file == nil {
		p.service.WriteError(w, relay.NewError(http.StatusNotFound, "file not found"))
		return
	}
	// Images never change
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	relay.WriteJSON(w, file)
}

func (p *Plugin) handleAddFile(w http.ResponseWriter, r *http.Request) {
	fileID := mux.Vars(r)["file_id"]
	if !fileIDPattern.MatchString(fileID) {
		p.service.WriteError(w, relay.NewError(http.StatusBadRequest, "invalid file id"))
		return
	}
	var file BoardFile
	if err := relay.ReadJSON(w, r, maxFileBytes, &file); err != nil {
		p.service.WriteError(w, err)
		return
	}
	file.ID = fileID
	if !strings.HasPrefix(file.MimeType, "image/") || !strings.HasPrefix(file.DataURL, "data:"+file.MimeType+";base64,") {
		p.service.WriteError(w, relay.NewError(http.StatusBadRequest, "only images can be added to boards"))
		return
	}
	if len(file.DataURL) > maxFileBytes*4/3 {
		p.service.WriteError(w, relay.NewError(http.StatusRequestEntityTooLarge, "image too large"))
		return
	}

	doc, err := p.service.RequestDoc(r, true)
	if err != nil {
		p.service.WriteError(w, err)
		return
	}
	if err := p.boards.AddFile(doc.ID, &file); err != nil {
		p.service.WriteError(w, err)
		return
	}
	relay.WriteJSON(w, map[string]string{"status": "OK"})
}

func (p *Plugin) handleGetThumbnail(w http.ResponseWriter, r *http.Request) {
	doc, err := p.service.RequestDoc(r, false)
	if err != nil {
		p.service.WriteError(w, err)
		return
	}
	png, err := p.boards.GetThumbnail(doc.ID)
	if err != nil {
		p.service.WriteError(w, err)
		return
	}
	if png == nil {
		p.service.WriteError(w, relay.NewError(http.StatusNotFound, "no thumbnail"))
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(png)
}

func (p *Plugin) handleSetThumbnail(w http.ResponseWriter, r *http.Request) {
	png, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxThumbnailBytes))
	if err != nil {
		p.service.WriteError(w, relay.NewError(http.StatusRequestEntityTooLarge, "thumbnail too large"))
		return
	}
	if !bytes.HasPrefix(png, pngSignature) {
		p.service.WriteError(w, relay.NewError(http.StatusBadRequest, "the thumbnail must be a PNG image"))
		return
	}

	doc, err := p.service.RequestDoc(r, true)
	if err != nil {
		p.service.WriteError(w, err)
		return
	}
	if err := p.boards.SetThumbnail(doc.ID, png); err != nil {
		p.service.WriteError(w, err)
		return
	}
	relay.WriteJSON(w, map[string]string{"status": "OK"})
}
