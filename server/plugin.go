// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"

	"github.com/antimatterchat/antimatter-plugin-whiteboard/server/relay"
)

const (
	// A freehand stroke is an element with all its points; an import can be a whole scene
	maxUpdateBytes    = 4 * 1024 * 1024
	maxSnapshotBytes  = maxBoardBytes
	maxAwarenessBytes = 4 * 1024

	// The server merges the updates into the snapshot after this many updates or bytes
	compactAfterUpdates = 200
	compactAfterBytes   = 1024 * 1024

	// Past this many updates or bytes waiting for a merge (merges that keep failing), updates are
	// refused (409) until a merge works again
	maxPendingUpdates = 20 * compactAfterUpdates
	maxPendingBytes   = 2 * maxBoardBytes

	// Past snapshots kept as versions of a board
	keepVersions    = 20
	versionInterval = 10 * time.Minute

	// How long channel memberships are cached for the updates and pointer moves
	accessCacheTTL = 15 * time.Second
)

var (
	// A client sends at most one update at a time, batched every 50 ms, and its pointer every
	// 60 ms: these leave room for a few open boards per user
	updateRateLimit    = relay.RateLimit{PerSecond: 20, Burst: 60}
	awarenessRateLimit = relay.RateLimit{PerSecond: 40, Burst: 80}

	// The bytes of the updates: 2 MiB a second on average, in bursts of 16 MiB (an imported scene
	// is one update of up to maxUpdateBytes). Every merge parses the whole board: without it, a
	// client sending 4 MiB updates 20 times a second makes the server merge on every update.
	updateBytesRateLimit = relay.RateLimit{PerSecond: 2 * 1024 * 1024, Burst: 16 * 1024 * 1024}

	// New boards carry up to maxSnapshotBytes each: a few in a row, then one every five seconds
	createRateLimit = relay.RateLimit{PerSecond: 0.2, Burst: 20}
)

// Plugin implements the interface expected by the Antimatter server to communicate between the
// server and plugin processes.
type Plugin struct {
	plugin.MattermostPlugin

	// configurationLock synchronizes access to the configuration.
	configurationLock sync.RWMutex

	// configuration is the active plugin configuration. Consult getConfiguration and
	// setConfiguration for usage.
	configuration *configuration

	access  *relay.CachedAccess
	service *relay.Service
	boards  *boardStore
	router  *mux.Router

	// The libraries of shapes added by the admins
	libraries  *libraryStore
	libraryAPI libraryAPI
}

// OnActivate is invoked when the plugin is activated.
func (p *Plugin) OnActivate() error {
	var locker relay.Locker = relay.NewLocalLocker()
	if cfg := p.API.GetConfig(); cfg != nil && cfg.ClusterSettings.Enable != nil && *cfg.ClusterSettings.Enable {
		locker = relay.NewClusterLocker(p.API)
	}

	p.boards = &boardStore{kv: p.API}
	p.libraries = &libraryStore{kv: p.API}
	p.libraryAPI = p.API
	p.access = relay.NewCachedAccess(channelAccess{api: p.API}, accessCacheTTL)
	p.service = &relay.Service{
		Docs: relay.NewDocStore(p.API),
		Log: relay.NewLog(p.API, locker, relay.LogOptions{
			CompactAfterUpdates: compactAfterUpdates,
			CompactAfterBytes:   compactAfterBytes,
			MaxPendingUpdates:   maxPendingUpdates,
			MaxPendingBytes:     maxPendingBytes,
			KeepVersions:        keepVersions,
			VersionInterval:     versionInterval,
			Merge:               sceneMerger{now: time.Now}.merge,
		}),
		Hub:                  relay.NewHub(p.API),
		Access:               p.access,
		Logger:               p.API,
		DefaultTitle:         "Untitled board",
		OnTitled:             p.shareTitled,
		MaxUpdateBytes:       maxUpdateBytes,
		MaxSnapshotBytes:     maxSnapshotBytes,
		MaxAwarenessBytes:    maxAwarenessBytes,
		ValidateUpdate:       validateScene,
		UpdateRateLimit:      updateRateLimit,
		AwarenessRateLimit:   awarenessRateLimit,
		UpdateBytesRateLimit: updateBytesRateLimit,
		CreateRateLimit:      createRateLimit,
		OnDelete: func(doc *relay.Doc) error {
			return p.boards.DeleteBoard(doc.ID)
		},
	}
	p.router = p.newRouter()
	return nil
}

// ServeHTTP serves the plugin's REST API.
func (p *Plugin) ServeHTTP(_ *plugin.Context, w http.ResponseWriter, r *http.Request) {
	p.router.ServeHTTP(w, r)
}

// UserHasLeftChannel forgets the cached membership of users leaving (or removed from) a channel,
// so they stop receiving and making changes to its boards right away.
func (p *Plugin) UserHasLeftChannel(_ *plugin.Context, member *model.ChannelMember, _ *model.User) {
	if p.access != nil {
		p.access.Forget(member.UserId, member.ChannelId)
	}
}
