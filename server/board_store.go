// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"encoding/json"
	"net/http"
	"slices"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/pkg/errors"

	"github.com/antimatterchat/antimatter-plugin-whiteboard/server/relay"
)

const (
	fileKeyPrefix      = "file_"
	fileIndexKeyPrefix = "files_"
	thumbnailKeyPrefix = "thumb_"

	// maxFilesPerBoard caps the images of a board.
	maxFilesPerBoard = 500
	indexAttempts    = 10
)

// BoardFile is an image of a board, as Excalidraw keeps them (BinaryFileData).
type BoardFile struct {
	ID       string `json:"id"`
	MimeType string `json:"mimeType"`
	DataURL  string `json:"dataURL"`
	Created  int64  `json:"created"`
}

// boardStore keeps what the whiteboard keeps beside the relay: the images and the thumbnails of
// the boards.
type boardStore struct {
	kv relay.KV
}

func fileKey(boardID, fileID string) string {
	return fileKeyPrefix + boardID + "_" + fileID
}

// GetFile returns an image of a board, or nil if it doesn't exist.
func (s *boardStore) GetFile(boardID, fileID string) (*BoardFile, error) {
	data, appErr := s.kv.KVGet(fileKey(boardID, fileID))
	if appErr != nil {
		return nil, errors.Wrap(appErr, "failed to get the file")
	}
	if data == nil {
		return nil, nil
	}
	var file BoardFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, errors.Wrap(err, "failed to decode the file")
	}
	return &file, nil
}

// AddFile adds an image to a board. Images never change: adding an existing one does nothing.
func (s *boardStore) AddFile(boardID string, file *BoardFile) error {
	if err := s.updateIndex(boardID, func(ids []string) ([]string, error) {
		if slices.Contains(ids, file.ID) {
			return nil, nil
		}
		if len(ids) >= maxFilesPerBoard {
			return nil, relay.NewError(http.StatusBadRequest, "too many images on this board")
		}
		return append(ids, file.ID), nil
	}); err != nil {
		return err
	}

	data, err := json.Marshal(file)
	if err != nil {
		return errors.Wrap(err, "failed to encode the file")
	}
	if _, appErr := s.kv.KVSetWithOptions(fileKey(boardID, file.ID), data, model.PluginKVSetOptions{}); appErr != nil {
		return errors.Wrap(appErr, "failed to save the file")
	}
	return nil
}

// updateIndex changes the list of the images of a board with compare-and-set. update returns the
// new list, or nil to leave it unchanged.
func (s *boardStore) updateIndex(boardID string, update func(ids []string) ([]string, error)) error {
	key := fileIndexKeyPrefix + boardID
	for range indexAttempts {
		old, appErr := s.kv.KVGet(key)
		if appErr != nil {
			return errors.Wrap(appErr, "failed to get the files of the board")
		}
		var ids []string
		if old != nil {
			if err := json.Unmarshal(old, &ids); err != nil {
				return errors.Wrap(err, "failed to decode the files of the board")
			}
		}
		updated, err := update(ids)
		if err != nil || updated == nil {
			return err
		}
		data, err := json.Marshal(updated)
		if err != nil {
			return errors.Wrap(err, "failed to encode the files of the board")
		}
		ok, appErr := s.kv.KVSetWithOptions(key, data, model.PluginKVSetOptions{Atomic: true, OldValue: old})
		if appErr != nil {
			return errors.Wrap(appErr, "failed to save the files of the board")
		}
		if ok {
			return nil
		}
	}
	return errors.New("failed to update the files of the board: too many concurrent changes")
}

// GetThumbnail returns the PNG thumbnail of a board, or nil.
func (s *boardStore) GetThumbnail(boardID string) ([]byte, error) {
	data, appErr := s.kv.KVGet(thumbnailKeyPrefix + boardID)
	if appErr != nil {
		return nil, errors.Wrap(appErr, "failed to get the thumbnail")
	}
	return data, nil
}

func (s *boardStore) SetThumbnail(boardID string, png []byte) error {
	if _, appErr := s.kv.KVSetWithOptions(thumbnailKeyPrefix+boardID, png, model.PluginKVSetOptions{}); appErr != nil {
		return errors.Wrap(appErr, "failed to save the thumbnail")
	}
	return nil
}

// DeleteBoard removes the images and the thumbnail of a deleted board.
func (s *boardStore) DeleteBoard(boardID string) error {
	key := fileIndexKeyPrefix + boardID
	data, appErr := s.kv.KVGet(key)
	if appErr != nil {
		return errors.Wrap(appErr, "failed to get the files of the board")
	}
	var ids []string
	if data != nil {
		if err := json.Unmarshal(data, &ids); err != nil {
			return errors.Wrap(err, "failed to decode the files of the board")
		}
	}
	for _, id := range ids {
		if appErr := s.kv.KVDelete(fileKey(boardID, id)); appErr != nil {
			return errors.Wrap(appErr, "failed to delete a file")
		}
	}
	for _, k := range []string{key, thumbnailKeyPrefix + boardID} {
		if appErr := s.kv.KVDelete(k); appErr != nil {
			return errors.Wrap(appErr, "failed to delete the board's data")
		}
	}
	return nil
}
