// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/pkg/errors"

	"github.com/antimatterchat/antimatter-plugin-whiteboard/server/relay"
)

// Libraries are the shapes of .excalidrawlib files that admins add for everyone: server-wide ones,
// added by the system admins, and the libraries of a community (a team), added by its admins. They
// show in the library panel of Excalidraw, beside the user's own items, which Excalidraw keeps in
// the browser.

const (
	// maxLibraryFileBytes caps an uploaded .excalidrawlib file.
	maxLibraryFileBytes = 5 * 1024 * 1024

	// maxScopeLibraryBytes caps the libraries of the server, or of a community, all together: the
	// boards load them all when they open.
	maxScopeLibraryBytes = 20 * 1024 * 1024

	maxLibrariesPerScope = 100
	maxLibraryItems      = 1000
	maxItemElements      = 5000
	maxLibraryNameLength = 100
	maxItemNameLength    = 200

	libraryIndexServerKey    = "libs_server"
	libraryIndexTeamPrefix   = "libs_team_"
	libraryScopeKeyPrefix    = "lib_scope_"
	libraryItemsKeyPrefix    = "lib_items_"
	libraryFileType          = "excalidrawlib"
	libraryItemStatusPublish = "published"
)

// libraryElementTypes are the elements kept from the uploaded libraries. Images (their files aren't
// in .excalidrawlib files) and embeds (web pages loaded in a frame) are dropped.
var libraryElementTypes = map[string]bool{
	"rectangle": true, "diamond": true, "ellipse": true, "arrow": true, "line": true,
	"freedraw": true, "text": true, "frame": true, "magicframe": true,
}

// Library is a library of shapes, as listed.
type Library struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	TeamID    string `json:"team_id"`
	ItemCount int    `json:"item_count"`
	Size      int    `json:"size"`
	CreatorID string `json:"creator_id"`
	CreateAt  int64  `json:"create_at"`
	UpdateAt  int64  `json:"update_at"`
}

// Auditable returns what the audit log records of a library.
func (l *Library) Auditable() map[string]any {
	return map[string]any{
		"id":         l.ID,
		"name":       l.Name,
		"team_id":    l.TeamID,
		"item_count": l.ItemCount,
		"size":       l.Size,
		"creator_id": l.CreatorID,
	}
}

// libraryItem is an item of a library as the server keeps it, and as Excalidraw loads it
// (LibraryItem: a few elements, reused together).
type libraryItem struct {
	ID       string            `json:"id"`
	Status   string            `json:"status"`
	Elements []json.RawMessage `json:"elements"`
	Created  int64             `json:"created"`
	Name     string            `json:"name,omitempty"`
}

// libraryFile is a .excalidrawlib file: version 1 has "library" (lists of elements), version 2
// "libraryItems" (items, or lists of elements in its early days).
type libraryFile struct {
	Type         string            `json:"type"`
	Version      int               `json:"version"`
	Library      []json.RawMessage `json:"library"`
	LibraryItems []json.RawMessage `json:"libraryItems"`
}

func errLibrary(format string, args ...any) error {
	return relay.NewError(http.StatusBadRequest, fmt.Sprintf(format, args...))
}

// parseLibrary reads an uploaded .excalidrawlib file into the items to keep. Only the elements of
// drawable types are kept, their links only if they are web or mail addresses; items left without
// elements are skipped. libraryID prefixes the IDs of the items, unique to this library.
func parseLibrary(data []byte, libraryID string, now int64) (items []libraryItem, skipped int, err error) {
	if len(data) > maxLibraryFileBytes {
		return nil, 0, relay.NewError(http.StatusRequestEntityTooLarge, fmt.Sprintf("the library is too large (%d MB at most)", maxLibraryFileBytes/1024/1024))
	}
	var file libraryFile
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&file); err != nil {
		return nil, 0, errLibrary("this is not an Excalidraw library (.excalidrawlib) file")
	}
	if file.Type != libraryFileType || (file.Version != 1 && file.Version != 2) {
		return nil, 0, errLibrary("this is not an Excalidraw library (.excalidrawlib) file, version 1 or 2")
	}
	raw := file.LibraryItems
	if file.Version == 1 || (raw == nil && file.Library != nil) {
		raw = file.Library
	}
	if len(raw) > maxLibraryItems {
		return nil, 0, errLibrary("the library has too many items (%d at most)", maxLibraryItems)
	}

	for i, r := range raw {
		item, err := parseLibraryItem(r, now)
		if err != nil {
			return nil, 0, errLibrary("item %d of the library is invalid: %s", i+1, err.Error())
		}
		if len(item.Elements) == 0 {
			skipped++
			continue
		}
		item.ID = fmt.Sprintf("lib-%s-%d", libraryID, len(items))
		item.Status = libraryItemStatusPublish
		items = append(items, item)
	}
	if len(items) == 0 {
		return nil, skipped, errLibrary("the library has no shapes to add")
	}
	return items, skipped, nil
}

func parseLibraryItem(raw json.RawMessage, now int64) (libraryItem, error) {
	item := libraryItem{Created: now}
	var elements []json.RawMessage
	if trimmed := bytes.TrimSpace(raw); len(trimmed) > 0 && trimmed[0] == '[' {
		if err := unmarshalNumbers(raw, &elements); err != nil {
			return item, errors.New("not a list of elements")
		}
	} else {
		var v2 struct {
			Elements []json.RawMessage `json:"elements"`
			Created  json.Number       `json:"created"`
			Name     string            `json:"name"`
		}
		if err := unmarshalNumbers(raw, &v2); err != nil {
			return item, errors.New("not an item")
		}
		elements = v2.Elements
		if created, err := v2.Created.Int64(); err == nil && created > 0 {
			item.Created = created
		}
		item.Name = cleanName(v2.Name, maxItemNameLength)
	}
	if len(elements) > maxItemElements {
		return item, errors.Errorf("too many elements (%d at most)", maxItemElements)
	}

	for _, e := range elements {
		element, keep, err := sanitizeElement(e)
		if err != nil {
			return item, err
		}
		if keep {
			item.Elements = append(item.Elements, element)
		}
	}
	return item, nil
}

func unmarshalNumbers(data []byte, v any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	return decoder.Decode(v)
}

// sanitizeElement returns an element as it's kept, or false to drop it.
func sanitizeElement(raw json.RawMessage) (json.RawMessage, bool, error) {
	var element map[string]any
	if err := unmarshalNumbers(raw, &element); err != nil || element == nil {
		return nil, false, errors.New("an element is not an object")
	}
	id, _ := element["id"].(string)
	if id == "" || len(id) > maxIDLength {
		return nil, false, errors.New("an element has no valid id")
	}
	kind, _ := element["type"].(string)
	if !libraryElementTypes[kind] {
		return nil, false, nil
	}
	if link, ok := element["link"]; ok && link != nil {
		s, _ := link.(string)
		if !safeLink(s) {
			element["link"] = nil
		}
	}
	data, err := json.Marshal(element)
	if err != nil {
		return nil, false, errors.New("an element can't be encoded")
	}
	return data, true, nil
}

// safeLink returns whether a link of an element is kept: web and mail addresses only.
func safeLink(link string) bool {
	lower := strings.ToLower(strings.TrimSpace(link))
	return strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "mailto:")
}

// cleanName returns a name without control characters or surrounding spaces, cut to max characters.
func cleanName(name string, maxLength int) string {
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == utf8.RuneError {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) > maxLength {
		name = strings.TrimSpace(string([]rune(name)[:maxLength]))
	}
	return name
}

// libraryStore keeps the libraries in the plugin KV store: an index of the libraries of each scope
// (the server, or a team), and the items of each library, which never change.
type libraryStore struct {
	kv relay.KV
}

type libraryScope struct {
	TeamID string `json:"team_id"`
}

func libraryIndexKey(teamID string) string {
	if teamID == "" {
		return libraryIndexServerKey
	}
	return libraryIndexTeamPrefix + teamID
}

// List returns the libraries of the server (teamID empty) or of a team.
func (s *libraryStore) List(teamID string) ([]*Library, error) {
	data, appErr := s.kv.KVGet(libraryIndexKey(teamID))
	if appErr != nil {
		return nil, errors.Wrap(appErr, "failed to get the libraries")
	}
	libraries := []*Library{}
	if data != nil {
		if err := json.Unmarshal(data, &libraries); err != nil {
			return nil, errors.Wrap(err, "failed to decode the libraries")
		}
	}
	return libraries, nil
}

// Scope returns the team of a library (empty for the server's), and false if it doesn't exist.
func (s *libraryStore) Scope(libraryID string) (string, bool, error) {
	data, appErr := s.kv.KVGet(libraryScopeKeyPrefix + libraryID)
	if appErr != nil {
		return "", false, errors.Wrap(appErr, "failed to get the library")
	}
	if data == nil {
		return "", false, nil
	}
	var scope libraryScope
	if err := json.Unmarshal(data, &scope); err != nil {
		return "", false, errors.Wrap(err, "failed to decode the library")
	}
	return scope.TeamID, true, nil
}

// Items returns the items of a library, as JSON, or nil.
func (s *libraryStore) Items(libraryID string) ([]byte, error) {
	data, appErr := s.kv.KVGet(libraryItemsKeyPrefix + libraryID)
	if appErr != nil {
		return nil, errors.Wrap(appErr, "failed to get the library's items")
	}
	return data, nil
}

// Add adds a library and its items, within the limits of its scope.
func (s *libraryStore) Add(library *Library, items []libraryItem) error {
	data, err := json.Marshal(items)
	if err != nil {
		return errors.Wrap(err, "failed to encode the library")
	}
	library.Size = len(data)
	library.ItemCount = len(items)
	scope, err := json.Marshal(libraryScope{TeamID: library.TeamID})
	if err != nil {
		return errors.Wrap(err, "failed to encode the library")
	}
	if _, appErr := s.kv.KVSetWithOptions(libraryItemsKeyPrefix+library.ID, data, model.PluginKVSetOptions{}); appErr != nil {
		return errors.Wrap(appErr, "failed to save the library")
	}
	if _, appErr := s.kv.KVSetWithOptions(libraryScopeKeyPrefix+library.ID, scope, model.PluginKVSetOptions{}); appErr != nil {
		_ = s.removeData(library.ID)
		return errors.Wrap(appErr, "failed to save the library")
	}

	err = s.updateIndex(library.TeamID, func(libraries []*Library) ([]*Library, error) {
		if len(libraries) >= maxLibrariesPerScope {
			return nil, relay.NewError(http.StatusBadRequest, fmt.Sprintf("there are already %d libraries here: delete one first", maxLibrariesPerScope))
		}
		total := library.Size
		for _, l := range libraries {
			total += l.Size
		}
		if total > maxScopeLibraryBytes {
			return nil, relay.NewError(http.StatusRequestEntityTooLarge, fmt.Sprintf("the libraries here would take more than %d MB: delete one first", maxScopeLibraryBytes/1024/1024))
		}
		return append(libraries, library), nil
	})
	if err != nil {
		_ = s.removeData(library.ID)
	}
	return err
}

// Rename renames a library, and returns it.
func (s *libraryStore) Rename(teamID, libraryID, name string, now int64) (*Library, error) {
	var renamed *Library
	err := s.updateIndex(teamID, func(libraries []*Library) ([]*Library, error) {
		for _, l := range libraries {
			if l.ID == libraryID {
				l.Name = name
				l.UpdateAt = now
				renamed = l
				return libraries, nil
			}
		}
		return nil, relay.NewError(http.StatusNotFound, "library not found")
	})
	return renamed, err
}

// Delete removes a library and its items, and returns it.
func (s *libraryStore) Delete(teamID, libraryID string) (*Library, error) {
	var deleted *Library
	err := s.updateIndex(teamID, func(libraries []*Library) ([]*Library, error) {
		for i, l := range libraries {
			if l.ID == libraryID {
				deleted = l
				return append(libraries[:i:i], libraries[i+1:]...), nil
			}
		}
		return nil, relay.NewError(http.StatusNotFound, "library not found")
	})
	if err != nil {
		return nil, err
	}
	if err := s.removeData(libraryID); err != nil {
		return nil, err
	}
	return deleted, nil
}

func (s *libraryStore) removeData(libraryID string) error {
	for _, key := range []string{libraryItemsKeyPrefix + libraryID, libraryScopeKeyPrefix + libraryID} {
		if appErr := s.kv.KVDelete(key); appErr != nil {
			return errors.Wrap(appErr, "failed to delete the library")
		}
	}
	return nil
}

// updateIndex changes the libraries of a scope with compare-and-set. update returns the new list.
func (s *libraryStore) updateIndex(teamID string, update func(libraries []*Library) ([]*Library, error)) error {
	key := libraryIndexKey(teamID)
	for range indexAttempts {
		old, appErr := s.kv.KVGet(key)
		if appErr != nil {
			return errors.Wrap(appErr, "failed to get the libraries")
		}
		libraries := []*Library{}
		if old != nil {
			if err := json.Unmarshal(old, &libraries); err != nil {
				return errors.Wrap(err, "failed to decode the libraries")
			}
		}
		updated, err := update(libraries)
		if err != nil {
			return err
		}
		var data []byte
		if len(updated) > 0 {
			if data, err = json.Marshal(updated); err != nil {
				return errors.Wrap(err, "failed to encode the libraries")
			}
		}
		// A nil value deletes the key: the last library deleted leaves nothing behind
		ok, appErr := s.kv.KVSetWithOptions(key, data, model.PluginKVSetOptions{Atomic: true, OldValue: old})
		if appErr != nil {
			return errors.Wrap(appErr, "failed to save the libraries")
		}
		if ok {
			return nil
		}
	}
	return errors.New("failed to update the libraries: too many concurrent changes")
}
