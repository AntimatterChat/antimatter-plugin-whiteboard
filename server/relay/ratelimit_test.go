// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"net/http"
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRateLimiter(t *testing.T) {
	l := newRateLimiter(RateLimit{PerSecond: 2, Burst: 3})
	now := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)

	for range 3 {
		ok, _ := l.allow("ada", now)
		assert.True(t, ok)
	}
	ok, wait := l.allow("ada", now)
	assert.False(t, ok, "the burst is used up")
	assert.Equal(t, 500*time.Millisecond, wait)
	ok, _ = l.allow("bob", now)
	assert.True(t, ok, "each user has their own bucket")

	ok, _ = l.allow("ada", now.Add(500*time.Millisecond))
	assert.True(t, ok, "a token comes back every half second")
	ok, _ = l.allow("ada", now.Add(600*time.Millisecond))
	assert.False(t, ok)

	// Users who stopped are forgotten
	later := now.Add(time.Hour)
	ok, _ = l.allow("carol", later)
	assert.True(t, ok)
	assert.Len(t, l.buckets, 1)

	var off *rateLimiter
	ok, _ = off.allow("ada", now)
	assert.True(t, ok)
	ok, _ = newRateLimiter(RateLimit{}).allow("ada", now)
	assert.True(t, ok, "a zero limit doesn't limit")
}

func TestAPIRateLimits(t *testing.T) {
	ts := newTestService(LogOptions{})
	now := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	ts.Now = func() time.Time { return now }
	ts.UpdateRateLimit = RateLimit{PerSecond: 1, Burst: 2}
	ts.AwarenessRateLimit = RateLimit{PerSecond: 1, Burst: 1}
	alice, bob := model.NewId(), model.NewId()
	channelID := model.NewId()
	ts.access.set(alice, channelID, ReadWrite)
	ts.access.set(bob, channelID, ReadWrite)

	w, created := ts.do(t, alice, http.MethodPost, "/docs", map[string]any{"title": "Plan", "channel_id": channelID})
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	docID := created["id"].(string)
	update := map[string]any{"client_id": "c-1", "data": b64("u")}

	for range 2 {
		w, _ = ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/updates", update)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	}
	w, _ = ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/updates", update)
	assert.Equal(t, http.StatusTooManyRequests, w.Code)
	assert.Equal(t, "1", w.Header().Get("Retry-After"))
	w, _ = ts.do(t, bob, http.MethodPost, "/docs/"+docID+"/updates", update)
	assert.Equal(t, http.StatusOK, w.Code, "other users aren't slowed down")

	w, _ = ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/awareness", update)
	assert.Equal(t, http.StatusOK, w.Code, "presence has its own limit")
	w, _ = ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/awareness", update)
	assert.Equal(t, http.StatusTooManyRequests, w.Code)

	now = now.Add(time.Second)
	w, _ = ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/updates", update)
	assert.Equal(t, http.StatusOK, w.Code)
	w, _ = ts.do(t, alice, http.MethodPost, "/docs/"+docID+"/awareness", update)
	assert.Equal(t, http.StatusOK, w.Code)
}
