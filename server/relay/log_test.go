// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"bytes"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/antimatterchat/antimatter-plugin-whiteboard/server/relay/relaytest"
)

const testDocID = "doc4567890123456789012345"

func updatesData(updates []Update) []string {
	data := []string{}
	for _, u := range updates {
		data = append(data, string(u.Data))
	}
	return data
}

func TestLogAppendAndLoad(t *testing.T) {
	log := NewLog(relaytest.NewKV(), NewLocalLocker(), LogOptions{})

	state, err := log.Load(testDocID)
	require.NoError(t, err)
	assert.Nil(t, state.Snapshot)
	assert.Empty(t, state.Updates)
	assert.EqualValues(t, 0, state.LastSeq)

	for i := 1; i <= 3; i++ {
		result, err := log.Append(testDocID, fmt.Appendf(nil, "u%d", i))
		require.NoError(t, err)
		assert.EqualValues(t, i, result.Seq)
		assert.False(t, result.Compact)
	}

	state, err = log.Load(testDocID)
	require.NoError(t, err)
	assert.Equal(t, []string{"u1", "u2", "u3"}, updatesData(state.Updates))
	assert.EqualValues(t, 3, state.LastSeq)
	assert.EqualValues(t, 3, state.Updates[2].Seq)

	updates, reset, err := log.Since(testDocID, 1)
	require.NoError(t, err)
	assert.False(t, reset)
	assert.Equal(t, []string{"u2", "u3"}, updatesData(updates))

	updates, reset, err = log.Since(testDocID, 3)
	require.NoError(t, err)
	assert.False(t, reset)
	assert.Empty(t, updates)

	// A client ahead of the log (e.g. of a deleted document) starts again
	_, reset, err = log.Since(testDocID, 4)
	require.NoError(t, err)
	assert.True(t, reset)
}

func TestLogInit(t *testing.T) {
	log := NewLog(relaytest.NewKV(), NewLocalLocker(), LogOptions{})
	require.NoError(t, log.Init(testDocID, []byte("initial")))
	_, err := log.Append(testDocID, []byte("u1"))
	require.NoError(t, err)

	state, err := log.Load(testDocID)
	require.NoError(t, err)
	assert.Equal(t, "initial", string(state.Snapshot))
	assert.EqualValues(t, 0, state.SnapshotSeq)
	assert.Equal(t, []string{"u1"}, updatesData(state.Updates))
}

func TestLogClientCompaction(t *testing.T) {
	kv := relaytest.NewKV()
	log := NewLog(kv, NewLocalLocker(), LogOptions{CompactAfterUpdates: 3})

	var result *AppendResult
	var err error
	for i := 1; i <= 4; i++ {
		result, err = log.Append(testDocID, fmt.Appendf(nil, "u%d", i))
		require.NoError(t, err)
		assert.Equal(t, i >= 3, result.Compact, "update %d", i)
	}

	// The snapshot of the updates up to 3; the 4th stays
	require.NoError(t, log.Compact(testDocID, []byte("s3"), 3))
	assert.Equal(t, []string{"upd_" + testDocID + "_4"}, kv.Keys("upd_"))
	assert.Equal(t, []string{"snap_" + testDocID + "_3"}, kv.Keys("snap_"))

	state, err := log.Load(testDocID)
	require.NoError(t, err)
	assert.Equal(t, "s3", string(state.Snapshot))
	assert.EqualValues(t, 3, state.SnapshotSeq)
	assert.Equal(t, []string{"u4"}, updatesData(state.Updates))

	// Clients that missed compacted updates load the document again
	_, reset, err := log.Since(testDocID, 2)
	require.NoError(t, err)
	assert.True(t, reset)
	updates, reset, err := log.Since(testDocID, 3)
	require.NoError(t, err)
	assert.False(t, reset)
	assert.Equal(t, []string{"u4"}, updatesData(updates))

	assert.ErrorIs(t, log.Compact(testDocID, []byte("s2"), 2), ErrStaleSnapshot)
	assert.ErrorIs(t, log.Compact(testDocID, []byte("s9"), 9), ErrInvalidSnapshot)

	// Only one pending update: no compaction asked
	result, err = log.Append(testDocID, []byte("u5"))
	require.NoError(t, err)
	assert.False(t, result.Compact)
}

func TestLogCompactionBySize(t *testing.T) {
	log := NewLog(relaytest.NewKV(), NewLocalLocker(), LogOptions{CompactAfterBytes: 10})
	result, err := log.Append(testDocID, []byte("12345"))
	require.NoError(t, err)
	assert.False(t, result.Compact)
	result, err = log.Append(testDocID, []byte("67890"))
	require.NoError(t, err)
	assert.True(t, result.Compact)
}

func TestLogServerMerge(t *testing.T) {
	kv := relaytest.NewKV()
	merge := func(snapshot []byte, updates [][]byte) ([]byte, error) {
		return bytes.Join(append([][]byte{snapshot}, updates...), nil), nil
	}
	log := NewLog(kv, NewLocalLocker(), LogOptions{CompactAfterUpdates: 2, Merge: merge})
	assert.True(t, log.ServerMerges())

	for _, u := range []string{"a", "b", "c"} {
		result, err := log.Append(testDocID, []byte(u))
		require.NoError(t, err)
		assert.False(t, result.Compact)
	}

	state, err := log.Load(testDocID)
	require.NoError(t, err)
	assert.Equal(t, "ab", string(state.Snapshot))
	assert.EqualValues(t, 2, state.SnapshotSeq)
	assert.Equal(t, []string{"c"}, updatesData(state.Updates))
	assert.Equal(t, []string{"upd_" + testDocID + "_3"}, kv.Keys("upd_"))

	_, err = log.Append(testDocID, []byte("d"))
	require.NoError(t, err)
	state, err = log.Load(testDocID)
	require.NoError(t, err)
	assert.Equal(t, "abcd", string(state.Snapshot))
	assert.Empty(t, state.Updates)
	assert.Equal(t, []string{"snap_" + testDocID + "_4"}, kv.Keys("snap_"))
}

func TestLogVersions(t *testing.T) {
	kv := relaytest.NewKV()
	now := time.UnixMilli(1_000_000)
	log := NewLog(kv, NewLocalLocker(), LogOptions{
		KeepVersions:    2,
		VersionInterval: 10 * time.Minute,
		Now:             func() time.Time { return now },
	})

	compactAt := func(seq int64, snapshot string) {
		t.Helper()
		_, err := log.Append(testDocID, []byte("u"))
		require.NoError(t, err)
		require.NoError(t, log.Compact(testDocID, []byte(snapshot), seq))
	}

	compactAt(1, "s1") // no previous snapshot: nothing to keep
	versions, err := log.Versions(testDocID)
	require.NoError(t, err)
	assert.Empty(t, versions)

	now = now.Add(time.Minute)
	compactAt(2, "s2") // keeps s1, the first version
	now = now.Add(time.Minute)
	compactAt(3, "s3") // s2 is only a minute after s1: dropped
	now = now.Add(15 * time.Minute)
	compactAt(4, "s4") // s3 is 2 minutes after s1: dropped
	now = now.Add(15 * time.Minute)
	compactAt(5, "s5") // s4 is 17 minutes after s1: kept
	now = now.Add(15 * time.Minute)
	compactAt(6, "s6") // s5 kept, s1 dropped (2 versions at most)

	versions, err = log.Versions(testDocID)
	require.NoError(t, err)
	require.Len(t, versions, 2)
	assert.EqualValues(t, 4, versions[0].Seq)
	assert.EqualValues(t, 5, versions[1].Seq)

	data, err := log.Version(testDocID, 4)
	require.NoError(t, err)
	assert.Equal(t, "s4", string(data))
	data, err = log.Version(testDocID, 1)
	require.NoError(t, err)
	assert.Nil(t, data)

	assert.Equal(t, []string{
		"snap_" + testDocID + "_4",
		"snap_" + testDocID + "_5",
		"snap_" + testDocID + "_6",
	}, kv.Keys("snap_"))

	require.NoError(t, log.Delete(testDocID))
	assert.Empty(t, kv.Keys(""))
}

func TestLogDelete(t *testing.T) {
	kv := relaytest.NewKV()
	log := NewLog(kv, NewLocalLocker(), LogOptions{})
	require.NoError(t, log.Init(testDocID, []byte("s")))
	for range 3 {
		_, err := log.Append(testDocID, []byte("u"))
		require.NoError(t, err)
	}
	require.NoError(t, log.Delete(testDocID))
	assert.Empty(t, kv.Keys(""))
}

func TestLogConcurrentAppends(t *testing.T) {
	log := NewLog(relaytest.NewKV(), NewLocalLocker(), LogOptions{})

	var wg sync.WaitGroup
	seqs := make(chan int64, 50)
	for i := range 50 {
		wg.Go(func() {
			result, err := log.Append(testDocID, fmt.Appendf(nil, "u%d", i))
			assert.NoError(t, err)
			seqs <- result.Seq
		})
	}
	wg.Wait()
	close(seqs)

	seen := map[int64]bool{}
	for seq := range seqs {
		assert.False(t, seen[seq], "duplicate seq %d", seq)
		seen[seq] = true
	}
	state, err := log.Load(testDocID)
	require.NoError(t, err)
	assert.Len(t, state.Updates, 50)
	assert.EqualValues(t, 50, state.LastSeq)
}
