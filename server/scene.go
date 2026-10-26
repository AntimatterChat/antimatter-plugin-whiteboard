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
	// maxElements caps the elements of a scene sent by a client (an update or the initial
	// content), deleted ones included.
	maxElements = 50000
	maxIDLength = 64

	// maxBoardElements and maxBoardBytes cap the merged board (deleted elements included, until
	// they expire). Refusing to merge would stop the compaction of the board for good, so the merge
	// leaves out what would take the board past them instead: new elements, and changes that make
	// an element larger. Changes that keep an element's size or shrink it always apply, and so does
	// deleting an element (its tombstone may be up to tombstoneSlack bytes larger), so a full board
	// can be cleaned up. Without the caps, updates of new elements grow the snapshot without bound,
	// and every merge parses all of it.
	maxBoardElements = 50000
	maxBoardBytes    = 20 * 1024 * 1024
	tombstoneSlack   = 256

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

// parseScene reads the elements of a scene, refusing more than maxCount of them unless it is 0.
func parseScene(data []byte, maxCount int) ([]element, error) {
	var s scene
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(&s); err != nil {
		return nil, errors.Wrap(err, "invalid scene")
	}
	if maxCount > 0 && len(s.Elements) > maxCount {
		return nil, errors.Errorf("too many elements (%d at most)", maxCount)
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

// validateScene rejects the updates that aren't scenes, or hold too many elements.
func validateScene(data []byte) error {
	_, err := parseScene(data, maxElements)
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

	// maxElements and maxBytes cap the merged board (maxBoardElements and maxBoardBytes if 0).
	maxElements int
	maxBytes    int64
}

// merge merges the updates into the snapshot. The bool tells that it left content out to keep the
// board within its caps.
func (m sceneMerger) merge(snapshot []byte, updates [][]byte) ([]byte, bool, error) {
	full := false
	maxCount, maxBytes := m.maxElements, m.maxBytes
	if maxCount == 0 {
		maxCount = maxBoardElements
	}
	if maxBytes == 0 {
		maxBytes = maxBoardBytes
	}

	byID := map[string]*element{}
	order := 0
	var size int64
	// fits returns whether the incoming element, replacing current (nil for a new one), keeps the
	// board within the caps
	fits := func(current, incoming *element, growth int64, count int, total int64) bool {
		switch {
		case growth <= 0:
			return true
		case current == nil:
			return count < maxCount && total+growth <= maxBytes
		case incoming.head.IsDeleted && !current.head.IsDeleted && growth <= tombstoneSlack:
			return true
		}
		return total+growth <= maxBytes
	}
	add := func(data []byte, capped bool) error {
		elements, err := parseScene(data, 0)
		if err != nil {
			return err
		}
		for _, e := range elements {
			current, ok := byID[e.head.ID]
			if ok && !wins(e.head, current.head) {
				continue
			}
			growth := int64(len(e.raw))
			if ok {
				growth -= int64(len(current.raw))
			}
			if capped && !fits(current, &e, growth, len(byID), size) {
				full = true
				continue
			}
			size += growth
			e.order = order
			if ok {
				e.order = current.order
			}
			order++
			byID[e.head.ID] = &e
		}
		return nil
	}

	// A board merged before the caps keeps what it has; it only can't grow
	if len(snapshot) > 0 {
		if err := add(snapshot, false); err != nil {
			return nil, false, errors.Wrap(err, "invalid snapshot")
		}
	}
	for _, update := range updates {
		// The updates were validated when they were posted: skip any that isn't valid anymore
		_ = add(update, true)
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

	out := scene{Elements: make([]json.RawMessage, 0, len(elements))}
	for _, e := range elements {
		out.Elements = append(out.Elements, e.raw)
	}
	merged, err := json.Marshal(out)
	return merged, full, err
}
