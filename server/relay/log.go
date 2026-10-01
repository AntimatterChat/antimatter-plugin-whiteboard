// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"strconv"
	"time"

	"github.com/pkg/errors"
)

const (
	logMetaKeyPrefix  = "log_"
	snapshotKeyPrefix = "snap_"
	updateKeyPrefix   = "upd_"

	// loadAttempts is how many times reading a document is retried when a compaction removes
	// the keys being read.
	loadAttempts = 5
)

// ErrStaleSnapshot is returned for a snapshot older than the current one.
var ErrStaleSnapshot = errors.New("the snapshot is older than the current one")

// ErrInvalidSnapshot is returned for a snapshot of updates the log doesn't have yet.
var ErrInvalidSnapshot = errors.New("the snapshot covers updates that don't exist")

// MergeFunc merges updates into a snapshot (nil for an empty document) and returns the new
// snapshot.
type MergeFunc func(snapshot []byte, updates [][]byte) ([]byte, error)

// LogOptions configures a Log.
type LogOptions struct {
	// When the updates after the snapshot reach CompactAfterUpdates or CompactAfterBytes, the
	// log compacts them into a new snapshot with Merge, or asks the clients to post one.
	CompactAfterUpdates int
	CompactAfterBytes   int64

	// Merge, if set, lets the server compact the log itself. Otherwise clients post snapshots.
	Merge MergeFunc

	// KeepVersions is how many past snapshots are kept as versions of the document, at least
	// VersionInterval apart. Zero keeps none.
	KeepVersions    int
	VersionInterval time.Duration

	// Now returns the current time (time.Now if nil).
	Now func() time.Time
}

// Update is an update of a document, numbered by its sequence number in the document's log.
type Update struct {
	Seq  int64  `json:"seq"`
	Data []byte `json:"data"`
}

// State is the content of a document: the snapshot of the updates up to SnapshotSeq and the
// updates after it, up to LastSeq.
type State struct {
	Snapshot    []byte   `json:"snapshot"`
	SnapshotSeq int64    `json:"snapshot_seq"`
	Updates     []Update `json:"updates"`
	LastSeq     int64    `json:"last_seq"`
}

// Version is a past snapshot of a document, kept to look at or restore older content.
type Version struct {
	Seq int64 `json:"seq"`
	At  int64 `json:"at"`
}

type logMeta struct {
	HasSnapshot  bool      `json:"has_snapshot,omitempty"`
	SnapshotSeq  int64     `json:"snapshot_seq"`
	SnapshotAt   int64     `json:"snapshot_at,omitempty"`
	LastSeq      int64     `json:"last_seq"`
	PendingBytes int64     `json:"pending_bytes"`
	Versions     []Version `json:"versions,omitempty"`
}

// Log keeps the updates of the documents. Writes to a document are serialized with the Locker;
// reads don't lock and retry when a compaction removes the keys they read.
//
// Keys: log_<doc> is the metadata, snap_<doc>_<seq> the snapshot of the updates up to seq (and the
// kept versions), upd_<doc>_<seq> the updates after the snapshot.
type Log struct {
	kv     KV
	locker Locker
	opts   LogOptions
}

func NewLog(kv KV, locker Locker, opts LogOptions) *Log {
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return &Log{kv: kv, locker: locker, opts: opts}
}

// ServerMerges returns whether the server compacts the log itself.
func (l *Log) ServerMerges() bool {
	return l.opts.Merge != nil
}

func logMetaKey(docID string) string {
	return logMetaKeyPrefix + docID
}

func snapshotKey(docID string, seq int64) string {
	return snapshotKeyPrefix + docID + "_" + strconv.FormatInt(seq, 10)
}

func updateKey(docID string, seq int64) string {
	return updateKeyPrefix + docID + "_" + strconv.FormatInt(seq, 10)
}

func (l *Log) getMeta(docID string) (*logMeta, error) {
	var meta logMeta
	if _, err := kvGetJSON(l.kv, logMetaKey(docID), &meta); err != nil {
		return nil, err
	}
	return &meta, nil
}

func (l *Log) lock(docID string) (func(), error) {
	return l.locker.Lock("log_" + docID)
}

// Init sets the initial content of a new document.
func (l *Log) Init(docID string, snapshot []byte) error {
	unlock, err := l.lock(docID)
	if err != nil {
		return err
	}
	defer unlock()

	if err := kvSet(l.kv, snapshotKey(docID, 0), snapshot); err != nil {
		return err
	}
	return kvSetJSON(l.kv, logMetaKey(docID), &logMeta{HasSnapshot: true, SnapshotAt: l.opts.Now().UnixMilli()})
}

// AppendResult is the result of Log.Append.
type AppendResult struct {
	Seq int64 `json:"seq"`

	// Compact tells the client to post a snapshot (only when the server doesn't merge).
	Compact bool `json:"compact"`
}

// Append adds an update to the log of a document.
func (l *Log) Append(docID string, data []byte) (*AppendResult, error) {
	unlock, err := l.lock(docID)
	if err != nil {
		return nil, err
	}
	defer unlock()

	meta, err := l.getMeta(docID)
	if err != nil {
		return nil, err
	}

	seq := meta.LastSeq + 1
	// The update is written before the metadata, so readers never see a missing update
	if err = kvSet(l.kv, updateKey(docID, seq), data); err != nil {
		return nil, err
	}
	meta.LastSeq = seq
	meta.PendingBytes += int64(len(data))
	if err = kvSetJSON(l.kv, logMetaKey(docID), meta); err != nil {
		return nil, err
	}

	result := &AppendResult{Seq: seq}
	if !l.needsCompaction(meta) {
		return result, nil
	}
	if l.opts.Merge == nil {
		result.Compact = true
		return result, nil
	}
	if err := l.mergeLocked(docID, meta); err != nil {
		// The update is stored: the next update retries the compaction
		return result, errors.Wrap(err, "failed to compact the document")
	}
	return result, nil
}

func (l *Log) needsCompaction(meta *logMeta) bool {
	pending := meta.LastSeq - meta.SnapshotSeq
	if pending == 0 {
		return false
	}
	return (l.opts.CompactAfterUpdates > 0 && pending >= int64(l.opts.CompactAfterUpdates)) ||
		(l.opts.CompactAfterBytes > 0 && meta.PendingBytes >= l.opts.CompactAfterBytes)
}

// mergeLocked compacts the log with the MergeFunc. The document must be locked.
func (l *Log) mergeLocked(docID string, meta *logMeta) error {
	var snapshot []byte
	if meta.HasSnapshot {
		var err error
		if snapshot, err = kvGet(l.kv, snapshotKey(docID, meta.SnapshotSeq)); err != nil {
			return err
		}
	}

	updates := make([][]byte, 0, meta.LastSeq-meta.SnapshotSeq)
	for seq := meta.SnapshotSeq + 1; seq <= meta.LastSeq; seq++ {
		data, err := kvGet(l.kv, updateKey(docID, seq))
		if err != nil {
			return err
		}
		if data != nil {
			updates = append(updates, data)
		}
	}

	merged, err := l.opts.Merge(snapshot, updates)
	if err != nil {
		return err
	}
	return l.replaceSnapshotLocked(docID, meta, merged, meta.LastSeq)
}

// Compact replaces the snapshot of a document by a snapshot of its updates up to seq, posted by
// a client.
func (l *Log) Compact(docID string, snapshot []byte, seq int64) error {
	unlock, err := l.lock(docID)
	if err != nil {
		return err
	}
	defer unlock()

	meta, err := l.getMeta(docID)
	if err != nil {
		return err
	}
	if seq <= meta.SnapshotSeq {
		return ErrStaleSnapshot
	}
	if seq > meta.LastSeq {
		return ErrInvalidSnapshot
	}
	return l.replaceSnapshotLocked(docID, meta, snapshot, seq)
}

// replaceSnapshotLocked writes the snapshot of the updates up to seq, then removes the updates
// it covers and the previous snapshot, unless that one is kept as a version.
func (l *Log) replaceSnapshotLocked(docID string, meta *logMeta, snapshot []byte, seq int64) error {
	now := l.opts.Now().UnixMilli()
	if err := kvSet(l.kv, snapshotKey(docID, seq), snapshot); err != nil {
		return err
	}

	previous := *meta
	meta.HasSnapshot = true
	meta.SnapshotSeq = seq
	meta.SnapshotAt = now

	// Keep the previous snapshot as a version when the last one is old enough
	keepPrevious := false
	var dropped []Version
	if l.opts.KeepVersions > 0 && previous.HasSnapshot && previous.SnapshotSeq > 0 {
		n := len(meta.Versions)
		if n == 0 || time.Duration(previous.SnapshotAt-meta.Versions[n-1].At)*time.Millisecond >= l.opts.VersionInterval {
			keepPrevious = true
			meta.Versions = append(meta.Versions, Version{Seq: previous.SnapshotSeq, At: previous.SnapshotAt})
			if extra := len(meta.Versions) - l.opts.KeepVersions; extra > 0 {
				dropped = append(dropped, meta.Versions[:extra]...)
				meta.Versions = append([]Version(nil), meta.Versions[extra:]...)
			}
		}
	}

	// The size of the updates that stay after the new snapshot
	meta.PendingBytes = 0
	for s := seq + 1; s <= meta.LastSeq; s++ {
		data, err := kvGet(l.kv, updateKey(docID, s))
		if err != nil {
			return err
		}
		meta.PendingBytes += int64(len(data))
	}

	if err := kvSetJSON(l.kv, logMetaKey(docID), meta); err != nil {
		return err
	}

	// Readers that loaded the previous metadata retry when these keys are gone
	if previous.HasSnapshot && !keepPrevious {
		if err := kvDelete(l.kv, snapshotKey(docID, previous.SnapshotSeq)); err != nil {
			return err
		}
	}
	for _, v := range dropped {
		if err := kvDelete(l.kv, snapshotKey(docID, v.Seq)); err != nil {
			return err
		}
	}
	for s := previous.SnapshotSeq + 1; s <= seq; s++ {
		if err := kvDelete(l.kv, updateKey(docID, s)); err != nil {
			return err
		}
	}
	return nil
}

// Load returns the content of a document.
func (l *Log) Load(docID string) (*State, error) {
	for range loadAttempts {
		state, complete, err := l.tryLoad(docID)
		if err != nil {
			return nil, err
		}
		if complete {
			return state, nil
		}
	}
	return nil, errors.New("failed to load the document: too many concurrent changes")
}

func (l *Log) tryLoad(docID string) (*State, bool, error) {
	meta, err := l.getMeta(docID)
	if err != nil {
		return nil, false, err
	}

	state := &State{SnapshotSeq: meta.SnapshotSeq, LastSeq: meta.LastSeq, Updates: []Update{}}
	if meta.HasSnapshot {
		if state.Snapshot, err = kvGet(l.kv, snapshotKey(docID, meta.SnapshotSeq)); err != nil {
			return nil, false, err
		}
		if state.Snapshot == nil {
			return nil, false, nil
		}
	}

	updates, complete, err := l.readUpdates(docID, meta.SnapshotSeq, meta.LastSeq)
	if err != nil || !complete {
		return nil, false, err
	}
	state.Updates = updates
	return state, true, nil
}

// readUpdates reads the updates after `after`, up to `last`. It returns false if some are missing
// because a compaction removed them.
func (l *Log) readUpdates(docID string, after, last int64) ([]Update, bool, error) {
	updates := make([]Update, 0, last-after)
	for seq := after + 1; seq <= last; seq++ {
		data, err := kvGet(l.kv, updateKey(docID, seq))
		if err != nil {
			return nil, false, err
		}
		if data == nil {
			return nil, false, nil
		}
		updates = append(updates, Update{Seq: seq, Data: data})
	}
	return updates, true, nil
}

// Since returns the updates after the given sequence number. reset is true when they were
// compacted into a snapshot: the client has to load the whole document again.
func (l *Log) Since(docID string, after int64) (updates []Update, reset bool, err error) {
	for range loadAttempts {
		meta, err := l.getMeta(docID)
		if err != nil {
			return nil, false, err
		}
		if after < meta.SnapshotSeq || after > meta.LastSeq {
			return nil, true, nil
		}

		updates, complete, err := l.readUpdates(docID, after, meta.LastSeq)
		if err != nil {
			return nil, false, err
		}
		if complete {
			return updates, false, nil
		}
	}
	return nil, false, errors.New("failed to read the updates: too many concurrent changes")
}

// Versions returns the kept versions of a document, oldest first.
func (l *Log) Versions(docID string) ([]Version, error) {
	meta, err := l.getMeta(docID)
	if err != nil {
		return nil, err
	}
	if meta.Versions == nil {
		return []Version{}, nil
	}
	return meta.Versions, nil
}

// Version returns the snapshot of a kept version, or nil if there is no such version.
func (l *Log) Version(docID string, seq int64) ([]byte, error) {
	versions, err := l.Versions(docID)
	if err != nil {
		return nil, err
	}
	for _, v := range versions {
		if v.Seq == seq {
			return kvGet(l.kv, snapshotKey(docID, seq))
		}
	}
	return nil, nil
}

// Delete removes the content of a document.
func (l *Log) Delete(docID string) error {
	unlock, err := l.lock(docID)
	if err != nil {
		return err
	}
	defer unlock()

	meta, err := l.getMeta(docID)
	if err != nil {
		return err
	}
	if err := kvDelete(l.kv, logMetaKey(docID)); err != nil {
		return err
	}
	if meta.HasSnapshot {
		if err := kvDelete(l.kv, snapshotKey(docID, meta.SnapshotSeq)); err != nil {
			return err
		}
	}
	for _, v := range meta.Versions {
		if err := kvDelete(l.kv, snapshotKey(docID, v.Seq)); err != nil {
			return err
		}
	}
	for seq := meta.SnapshotSeq + 1; seq <= meta.LastSeq; seq++ {
		if err := kvDelete(l.kv, updateKey(docID, seq)); err != nil {
			return err
		}
	}
	return nil
}
