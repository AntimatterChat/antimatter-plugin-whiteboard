// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func el(id string, version, nonce int, index string, extra string) string {
	idx := "null"
	if index != "" {
		idx = fmt.Sprintf("%q", index)
	}
	if extra != "" {
		extra = "," + extra
	}
	return fmt.Sprintf(`{"id":%q,"version":%d,"versionNonce":%d,"index":%s%s}`, id, version, nonce, idx, extra)
}

func sceneOf(elements ...string) []byte {
	return []byte(`{"elements":[` + strings.Join(elements, ",") + `]}`)
}

// summary returns id:version of the elements of a scene, in order.
func summary(t *testing.T, data []byte) []string {
	t.Helper()
	var s struct {
		Elements []struct {
			ID      string `json:"id"`
			Version int    `json:"version"`
		} `json:"elements"`
	}
	require.NoError(t, json.Unmarshal(data, &s))
	out := []string{}
	for _, e := range s.Elements {
		out = append(out, fmt.Sprintf("%s:%d", e.ID, e.Version))
	}
	return out
}

func TestValidateScene(t *testing.T) {
	assert.NoError(t, validateScene(sceneOf()))
	assert.NoError(t, validateScene(sceneOf(el("a", 1, 1, "a0", `"type":"rectangle"`))))
	assert.Error(t, validateScene([]byte("not json")))
	assert.Error(t, validateScene([]byte(`{"elements":[{"version":1}]}`)))
	assert.Error(t, validateScene([]byte(`{"elements":[{"id":"a"}]}`)))
	assert.Error(t, validateScene([]byte(`{"elements":[{"id":"`+strings.Repeat("x", 100)+`","version":1}]}`)))
	assert.Error(t, validateScene([]byte(`{"elements":{}}`)))
}

func TestMergeScenes(t *testing.T) {
	now := time.UnixMilli(10 * 24 * 3600 * 1000)
	m := sceneMerger{now: func() time.Time { return now }}

	snapshot := sceneOf(el("a", 1, 5, "a0", ""), el("b", 3, 5, "a1", ""))
	merged, err := m.merge(snapshot, [][]byte{
		sceneOf(el("a", 2, 9, "a0", "")),  // newer version wins
		sceneOf(el("b", 2, 1, "a1", "")),  // older version loses
		sceneOf(el("c", 1, 1, "Zz", "")),  // new, ordered by index before a0
		sceneOf(el("d", 1, 1, "", "")),    // no index: last
		sceneOf(el("b", 3, 2, "a1", "")),  // same version, lower nonce wins
		sceneOf(el("a", 2, 10, "a0", "")), // same version, higher nonce loses
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"c:1", "a:2", "b:3", "d:1"}, summary(t, merged))
	assert.Contains(t, string(merged), `"versionNonce":2`)
	assert.Contains(t, string(merged), `"versionNonce":9`)

	// Merging is idempotent
	again, err := m.merge(merged, [][]byte{snapshot})
	require.NoError(t, err)
	assert.JSONEq(t, string(merged), string(again))
}

func TestMergeScenesKeepsFields(t *testing.T) {
	m := sceneMerger{now: time.Now}
	merged, err := m.merge(nil, [][]byte{sceneOf(el("a", 1, 1, "a0", `"type":"text","text":"hi","customData":{"x":1}`))})
	require.NoError(t, err)
	assert.JSONEq(t, `{"elements":[{"id":"a","version":1,"versionNonce":1,"index":"a0","type":"text","text":"hi","customData":{"x":1}}]}`, string(merged))
}

func TestMergeScenesDropsOldTombstones(t *testing.T) {
	now := time.UnixMilli(10 * 24 * 3600 * 1000)
	m := sceneMerger{now: func() time.Time { return now }}
	recent := now.Add(-time.Hour).UnixMilli()
	old := now.Add(-48 * time.Hour).UnixMilli()

	merged, err := m.merge(nil, [][]byte{sceneOf(
		el("kept", 2, 1, "a0", fmt.Sprintf(`"isDeleted":true,"updated":%d`, recent)),
		el("gone", 2, 1, "a1", fmt.Sprintf(`"isDeleted":true,"updated":%d`, old)),
		el("live", 1, 1, "a2", fmt.Sprintf(`"updated":%d`, old)),
	)})
	require.NoError(t, err)
	assert.Equal(t, []string{"kept:2", "live:1"}, summary(t, merged))
}

func TestMergeScenesSkipsInvalidUpdates(t *testing.T) {
	m := sceneMerger{now: time.Now}
	merged, err := m.merge(nil, [][]byte{[]byte("garbage"), sceneOf(el("a", 1, 1, "a0", ""))})
	require.NoError(t, err)
	assert.Equal(t, []string{"a:1"}, summary(t, merged))

	_, err = m.merge([]byte("garbage"), nil)
	assert.Error(t, err)
}
