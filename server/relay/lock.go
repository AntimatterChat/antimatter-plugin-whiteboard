// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"sync"

	"github.com/mattermost/mattermost/server/public/pluginapi/cluster"
	"github.com/pkg/errors"
)

// Locker serializes the writes to a document.
type Locker interface {
	// Lock locks the key and returns the function that unlocks it.
	Lock(key string) (unlock func(), err error)
}

// LocalLocker locks keys within this process. It is enough when the server isn't a cluster.
type LocalLocker struct {
	mu    sync.Mutex
	locks map[string]*keyLock
}

type keyLock struct {
	sync.Mutex
	users int
}

func NewLocalLocker() *LocalLocker {
	return &LocalLocker{locks: map[string]*keyLock{}}
}

func (l *LocalLocker) Lock(key string) (func(), error) {
	l.mu.Lock()
	lock := l.locks[key]
	if lock == nil {
		lock = &keyLock{}
		l.locks[key] = lock
	}
	lock.users++
	l.mu.Unlock()

	lock.Lock()
	return func() {
		lock.Unlock()
		l.mu.Lock()
		lock.users--
		if lock.users == 0 {
			delete(l.locks, key)
		}
		l.mu.Unlock()
	}, nil
}

// ClusterLocker locks keys across the servers of a cluster with a KV store mutex. A local lock
// in front of it keeps the requests of this server from polling the KV store for each other.
type ClusterLocker struct {
	api   cluster.MutexPluginAPI
	local *LocalLocker
}

func NewClusterLocker(api cluster.MutexPluginAPI) *ClusterLocker {
	return &ClusterLocker{api: api, local: NewLocalLocker()}
}

func (l *ClusterLocker) Lock(key string) (func(), error) {
	unlockLocal, _ := l.local.Lock(key)

	mutex, err := cluster.NewMutex(l.api, "relay_"+key)
	if err != nil {
		unlockLocal()
		return nil, errors.Wrap(err, "failed to create the cluster mutex")
	}
	mutex.Lock()

	return func() {
		mutex.Unlock()
		unlockLocal()
	}, nil
}
