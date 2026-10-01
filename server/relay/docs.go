// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"slices"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/pkg/errors"
)

const (
	docKeyPrefix          = "doc_"
	channelIndexKeyPrefix = "chdocs_"
	userIndexKeyPrefix    = "udocs_"

	// MaxDocsPerIndex caps the documents of a channel, and the personal documents of a user.
	MaxDocsPerIndex = 1000
)

// ErrTooManyDocs is returned when a channel or a user has too many documents.
var ErrTooManyDocs = errors.New("too many documents")

// Doc describes a document. A document belongs either to a channel, and its members can edit it,
// or to a user (a personal document).
type Doc struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	ChannelID string `json:"channel_id,omitempty"`
	OwnerID   string `json:"owner_id,omitempty"`
	CreatorID string `json:"creator_id"`
	CreateAt  int64  `json:"create_at"`

	// UpdateAt and UpdatedBy tell when and by whom the document or its content was last changed.
	UpdateAt  int64  `json:"update_at"`
	UpdatedBy string `json:"updated_by,omitempty"`
}

// IsPersonal returns whether the document is a personal document.
func (d *Doc) IsPersonal() bool {
	return d.ChannelID == ""
}

// DocStore keeps the documents and the indexes of the documents of each channel and user.
type DocStore struct {
	kv KV
}

func NewDocStore(kv KV) *DocStore {
	return &DocStore{kv: kv}
}

func docKey(id string) string {
	return docKeyPrefix + id
}

func indexKey(doc *Doc) string {
	if doc.IsPersonal() {
		return userIndexKeyPrefix + doc.OwnerID
	}
	return channelIndexKeyPrefix + doc.ChannelID
}

// Get returns the document, or nil if it doesn't exist.
func (s *DocStore) Get(id string) (*Doc, error) {
	var doc Doc
	found, err := kvGetJSON(s.kv, docKey(id), &doc)
	if err != nil || !found {
		return nil, err
	}
	return &doc, nil
}

// Create adds a new document to the store and to its index.
func (s *DocStore) Create(doc *Doc) error {
	err := kvUpdateJSON(s.kv, indexKey(doc), func(ids *[]string) (bool, error) {
		if slices.Contains(*ids, doc.ID) {
			return false, nil
		}
		if len(*ids) >= MaxDocsPerIndex {
			return false, ErrTooManyDocs
		}
		*ids = append(*ids, doc.ID)
		return true, nil
	})
	if err != nil {
		return err
	}
	return kvSetJSON(s.kv, docKey(doc.ID), doc)
}

// Update atomically changes an existing document. change returns whether to save the document.
// It returns the updated document, or nil if it doesn't exist.
func (s *DocStore) Update(id string, change func(doc *Doc) bool) (*Doc, error) {
	var updated *Doc
	err := kvUpdateJSON(s.kv, docKey(id), func(doc *Doc) (bool, error) {
		// Don't bring back a deleted document
		if doc.ID == "" {
			updated = nil
			return false, nil
		}
		updated = doc
		return change(doc), nil
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}

// Delete removes the document from the store and from its index. Its content is removed by
// the Log.
func (s *DocStore) Delete(doc *Doc) error {
	if err := kvDelete(s.kv, docKey(doc.ID)); err != nil {
		return err
	}
	err := kvUpdateJSON(s.kv, indexKey(doc), func(ids *[]string) (bool, error) {
		i := slices.Index(*ids, doc.ID)
		if i < 0 {
			return false, nil
		}
		*ids = slices.Delete(*ids, i, i+1)
		return true, nil
	})
	if err != nil {
		return err
	}

	// Remove the index once empty, unless a document was added meanwhile
	if _, appErr := s.kv.KVSetWithOptions(indexKey(doc), nil, model.PluginKVSetOptions{Atomic: true, OldValue: []byte("[]")}); appErr != nil {
		return errors.Wrap(appErr, "failed to remove an empty index")
	}
	return nil
}

// ListChannel returns the documents of a channel.
func (s *DocStore) ListChannel(channelID string) ([]*Doc, error) {
	return s.list(channelIndexKeyPrefix + channelID)
}

// ListPersonal returns the personal documents of a user.
func (s *DocStore) ListPersonal(userID string) ([]*Doc, error) {
	return s.list(userIndexKeyPrefix + userID)
}

func (s *DocStore) list(key string) ([]*Doc, error) {
	var ids []string
	if _, err := kvGetJSON(s.kv, key, &ids); err != nil {
		return nil, err
	}

	docs := make([]*Doc, 0, len(ids))
	for _, id := range ids {
		doc, err := s.Get(id)
		if err != nil {
			return nil, err
		}
		// An index may briefly list a document being created or deleted
		if doc != nil {
			docs = append(docs, doc)
		}
	}
	return docs, nil
}
