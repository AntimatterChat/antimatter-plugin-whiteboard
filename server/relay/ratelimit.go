// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// RateLimit is how many requests of a kind each user can make: PerSecond on average, in bursts of
// up to Burst. A zero RateLimit doesn't limit anything.
type RateLimit struct {
	PerSecond float64
	Burst     int
}

// limiterSweepInterval is how often the buckets of users who stopped making requests are dropped.
const limiterSweepInterval = time.Minute

// rateLimiter keeps a token bucket per user. It's per server: in a cluster, each server limits the
// requests it serves.
type rateLimiter struct {
	limit RateLimit

	mu        sync.Mutex
	buckets   map[string]*tokenBucket
	lastSweep time.Time
}

type tokenBucket struct {
	tokens float64
	last   time.Time
}

func newRateLimiter(limit RateLimit) *rateLimiter {
	return &rateLimiter{limit: limit, buckets: map[string]*tokenBucket{}}
}

// allow takes a token from a user's bucket. When it's empty, it returns how long until the next
// token.
func (l *rateLimiter) allow(userID string, now time.Time) (bool, time.Duration) {
	if l == nil || l.limit.PerSecond <= 0 || l.limit.Burst <= 0 {
		return true, 0
	}
	burst := float64(l.limit.Burst)

	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.lastSweep) >= limiterSweepInterval {
		// Full buckets are like new ones
		for id, b := range l.buckets {
			if b.tokens+now.Sub(b.last).Seconds()*l.limit.PerSecond >= burst {
				delete(l.buckets, id)
			}
		}
		l.lastSweep = now
	}

	b, ok := l.buckets[userID]
	if !ok {
		b = &tokenBucket{tokens: burst, last: now}
		l.buckets[userID] = b
	}
	if now.After(b.last) {
		b.tokens = math.Min(burst, b.tokens+now.Sub(b.last).Seconds()*l.limit.PerSecond)
		b.last = now
	}
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	return false, time.Duration((1 - b.tokens) / l.limit.PerSecond * float64(time.Second))
}

// limiters returns the rate limiters of the updates and the presence messages.
func (s *Service) limiters() (*rateLimiter, *rateLimiter) {
	s.limitersOnce.Do(func() {
		s.updateLimiter = newRateLimiter(s.UpdateRateLimit)
		s.awarenessLimiter = newRateLimiter(s.AwarenessRateLimit)
	})
	return s.updateLimiter, s.awarenessLimiter
}

// rateLimited answers 429 Too Many Requests, with the seconds to wait in Retry-After, when the user
// made too many requests of a kind. It returns whether it did.
func (s *Service) rateLimited(w http.ResponseWriter, r *http.Request, limiter *rateLimiter, what string) bool {
	ok, wait := limiter.allow(UserID(r), s.now())
	if ok {
		return false
	}
	w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
	WriteJSONStatus(w, http.StatusTooManyRequests, map[string]string{"error": "too many " + what + ", slow down"})
	return true
}
