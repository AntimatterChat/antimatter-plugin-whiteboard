// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"net/http"
	"slices"
)

const (
	favoritesKeyPrefix = "ufav_"

	// MaxFavorites caps the favorite documents of a user.
	MaxFavorites = 200
)

// ListFavorites returns the IDs of a user's favorite documents, the latest first.
func (s *DocStore) ListFavorites(userID string) ([]string, error) {
	var ids []string
	if _, err := kvGetJSON(s.kv, favoritesKeyPrefix+userID, &ids); err != nil {
		return nil, err
	}
	return ids, nil
}

// SetFavorite adds a document to a user's favorites, or removes it.
func (s *DocStore) SetFavorite(userID, docID string, favorite bool) error {
	return kvUpdateJSON(s.kv, favoritesKeyPrefix+userID, func(ids *[]string) (bool, error) {
		i := slices.Index(*ids, docID)
		switch {
		case favorite && i >= 0, !favorite && i < 0:
			return false, nil
		case favorite:
			if len(*ids) >= MaxFavorites {
				return false, NewError(http.StatusBadRequest, "too many favorites")
			}
			*ids = append([]string{docID}, *ids...)
		default:
			*ids = slices.Delete(*ids, i, i+1)
		}
		return true, nil
	})
}

// handleFavorites lists the user's favorite documents they can still open.
func (s *Service) handleFavorites(w http.ResponseWriter, r *http.Request) {
	userID := UserID(r)
	ids, err := s.Docs.ListFavorites(userID)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	response := make([]DocResponse, 0, len(ids))
	for _, id := range ids {
		doc, err := s.Docs.Get(id)
		if err != nil {
			s.WriteError(w, err)
			return
		}
		if doc == nil {
			continue
		}
		permission, err := s.DocPermission(userID, doc)
		if err != nil {
			s.WriteError(w, err)
			return
		}
		if permission == NoAccess {
			continue
		}
		response = append(response, s.docResponse(userID, doc, permission))
	}
	WriteJSON(w, response)
}

// handleFavorite adds a document to the user's favorites (PUT), or removes it (DELETE).
func (s *Service) handleFavorite(w http.ResponseWriter, r *http.Request) {
	doc, err := s.RequestDoc(r, false)
	if err != nil {
		s.WriteError(w, err)
		return
	}
	if err = s.Docs.SetFavorite(UserID(r), doc.ID, r.Method == http.MethodPut); err != nil {
		s.WriteError(w, err)
		return
	}
	WriteJSON(w, map[string]bool{"favorite": r.Method == http.MethodPut})
}

// isFavorite tells whether a document is one of the user's favorites.
func (s *Service) isFavorite(userID, docID string) bool {
	ids, err := s.Docs.ListFavorites(userID)
	return err == nil && slices.Contains(ids, docID)
}
