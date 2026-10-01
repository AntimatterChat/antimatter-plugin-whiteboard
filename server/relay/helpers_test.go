// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"sync"
)

// fakeAccess gives the permissions set in its maps.
type fakeAccess struct {
	mu          sync.Mutex
	permissions map[string]Permission // userID/channelID
	admins      map[string]bool       // userID/channelID
	calls       int
}

func newFakeAccess() *fakeAccess {
	return &fakeAccess{permissions: map[string]Permission{}, admins: map[string]bool{}}
}

func (f *fakeAccess) set(userID, channelID string, p Permission) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.permissions[userID+"/"+channelID] = p
}

func (f *fakeAccess) ChannelPermission(userID, channelID string) (Permission, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	return f.permissions[userID+"/"+channelID], nil
}

func (f *fakeAccess) CanManageChannel(userID, channelID string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.admins[userID+"/"+channelID]
}
