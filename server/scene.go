// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"bytes"
	"encoding/json"
	"sort"
	"time"

	"github.com/pkg/errors"
)

const (
	// maxElements caps the elements of a board, deleted ones included.
	maxElements = 50000
	maxIDLength = 64

	// Deleted elements are kept this long, so that the clients that were offline learn about the
	// deletion instead of bringing the elements back.
	tombstoneTTL = 24 * time.Hour
)

// A board's snapshot and its updates are scenes: {"elements": [...]}, with the elements of
// Excalidraw. The server only reads what it needs to merge them.
type scene struct {
	Elements []json.RawMessage `json:"elements"`
}

// elementHead is the part of an Excalidraw element used to merge scenes.
type elementHead struct {
	ID           string  `json:"id"`
	Version      *int64  `json:"version"`
	VersionNonce int64   `json:"versionNonce"`
	Index        *string `json:"index"`
	IsDeleted    bool    `json:"isDeleted"`
	Updated      int64   `json:"updated"`
}

type element struct {
	head  elementHead
	raw   json.RawMessage
	order int
}

func parseScene(data []byte) ([]element, error) {
	var s scene
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(&s); err != nil {
		return nil, errors.Wrap(err, "invalid scene")
	}
	if len(s.Elements) > maxElements {
		return nil, errors.Errorf("too many elements (%d at most)", maxElements)
	}

	elements := make([]element, 0, len(s.Elements))
	for i, raw := range s.Elements {
		var head elementHead
		if err := json.Unmarshal(raw, &head); err != nil {
			return nil, errors.Wrapf(err, "invalid element %d", i)
		}
		if head.ID == "" || len(head.ID) > maxIDLength || head.Version == nil {
			return nil, errors.Errorf("invalid element %d: it needs an id and a version", i)
		}
		elements = append(elements, element{head: head, raw: raw})
	}
	return elements, nil
}

// validateScene rejects the updates that aren't scenes.
func validateScene(data []byte) error {
	_, err := parseScene(data)
	return err
}

// wins returns whether the incoming element replaces the current one, as Excalidraw reconciles
// elements: the higher version wins, then the lower version nonce.
func wins(incoming, current elementHead) bool {
	if *incoming.Version != *current.Version {
		return *incoming.Version > *current.Version
	}
	return incoming.VersionNonce < current.VersionNonce
}

// sceneMerger merges scene updates into a board's snapshot.
type sceneMerger struct {
	now func() time.Time
}

func (m sceneMerger) merge(snapshot []byte, updates [][]byte) ([]byte, error) {
	byID := map[string]*element{}
	order := 0
	add := func(data []byte) error {
		elements, err := parseScene(data)
		if err != nil {
			return err
		}
		for _, e := range elements {
			current, ok := byID[e.head.ID]
			if ok && !wins(e.head, current.head) {
				continue
			}
			e.order = order
			if ok {
				e.order = current.order
			}
			order++
			byID[e.head.ID] = &e
		}
		return nil
	}

	if len(snapshot) > 0 {
		if err := add(snapshot); err != nil {
			return nil, errors.Wrap(err, "invalid snapshot")
		}
	}
	for _, update := range updates {
		// The updates were validated when they were posted: skip any that isn't valid anymore
		_ = add(update)
	}

	expired := m.now().Add(-tombstoneTTL).UnixMilli()
	elements := make([]*element, 0, len(byID))
	for _, e := range byID {
		if e.head.IsDeleted && e.head.Updated < expired {
			continue
		}
		elements = append(elements, e)
	}

	// The order of the elements is their fractional index, then the order they were added in
	sort.SliceStable(elements, func(i, j int) bool {
		a, b := elements[i].head.Index, elements[j].head.Index
		switch {
		case a != nil && b != nil && *a != *b:
			return *a < *b
		case a != nil && b == nil:
			return true
		case a == nil && b != nil:
			return false
		}
		return elements[i].order < elements[j].order
	})

	merged := scene{Elements: make([]json.RawMessage, 0, len(elements))}
	for _, e := range elements {
		merged.Elements = append(merged.Elements, e.raw)
	}
	return json.Marshal(merged)
}
