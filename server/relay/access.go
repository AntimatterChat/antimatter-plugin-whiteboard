// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"sync"
	"time"
)

// Permission is what a user can do with the documents of a channel.
type Permission int

const (
	NoAccess Permission = iota
	ReadOnly
	ReadWrite
)

// Access tells what users can do with the documents of channels.
type Access interface {
	// ChannelPermission returns what the user can do with the documents of the channel.
	ChannelPermission(userID, channelID string) (Permission, error)

	// CanManageChannel returns whether the user can delete the documents of others in the channel.
	CanManageChannel(userID, channelID string) bool
}

// CachedAccess caches the channel permissions for a short while: they are checked for every
// update and cursor move. Forget drops the entries of a user who left a channel.
type CachedAccess struct {
	Access
	ttl time.Duration
	now func() time.Time

	mu      sync.Mutex
	entries map[cacheKey]cacheEntry
}

type cacheKey struct {
	userID    string
	channelID string
}

type cacheEntry struct {
	permission Permission
	expires    time.Time
}

// maxCacheEntries bounds the memory of the cache; it is emptied when full.
const maxCacheEntries = 10000

func NewCachedAccess(access Access, ttl time.Duration) *CachedAccess {
	return &CachedAccess{Access: access, ttl: ttl, now: time.Now, entries: map[cacheKey]cacheEntry{}}
}

func (c *CachedAccess) ChannelPermission(userID, channelID string) (Permission, error) {
	key := cacheKey{userID, channelID}
	now := c.now()

	c.mu.Lock()
	entry, ok := c.entries[key]
	c.mu.Unlock()
	if ok && now.Before(entry.expires) {
		return entry.permission, nil
	}

	permission, err := c.Access.ChannelPermission(userID, channelID)
	if err != nil {
		return NoAccess, err
	}

	c.mu.Lock()
	if len(c.entries) >= maxCacheEntries {
		c.entries = map[cacheKey]cacheEntry{}
	}
	c.entries[key] = cacheEntry{permission: permission, expires: now.Add(c.ttl)}
	c.mu.Unlock()
	return permission, nil
}

// Forget drops the cached permission of a user in a channel.
func (c *CachedAccess) Forget(userID, channelID string) {
	c.mu.Lock()
	delete(c.entries, cacheKey{userID, channelID})
	c.mu.Unlock()
}

// ForgetChannel drops the cached permissions of a channel, e.g. when it's archived.
func (c *CachedAccess) ForgetChannel(channelID string) {
	c.mu.Lock()
	for key := range c.entries {
		if key.channelID == channelID {
			delete(c.entries, key)
		}
	}
	c.mu.Unlock()
}
