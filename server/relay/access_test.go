// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCachedAccess(t *testing.T) {
	inner := newFakeAccess()
	inner.set("u1", "c1", ReadWrite)
	cached := NewCachedAccess(inner, time.Minute)
	now := time.Now()
	cached.now = func() time.Time { return now }

	check := func(want Permission, wantCalls int) {
		t.Helper()
		p, err := cached.ChannelPermission("u1", "c1")
		require.NoError(t, err)
		assert.Equal(t, want, p)
		assert.Equal(t, wantCalls, inner.calls)
	}

	check(ReadWrite, 1)
	check(ReadWrite, 1) // cached

	// The user left: forgotten right away
	inner.set("u1", "c1", NoAccess)
	cached.Forget("u1", "c1")
	check(NoAccess, 2)

	// Expired entries are checked again
	inner.set("u1", "c1", ReadOnly)
	now = now.Add(2 * time.Minute)
	check(ReadOnly, 3)

	inner.set("u1", "c1", ReadWrite)
	cached.ForgetChannel("c1")
	check(ReadWrite, 4)
}
