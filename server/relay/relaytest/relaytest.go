// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

// Package relaytest has in-memory implementations of the plugin APIs used by the relay, for tests.
package relaytest

import (
	"bytes"
	"sort"
	"strings"
	"sync"

	"github.com/mattermost/mattermost/server/public/model"
)

// KV is an in-memory plugin KV store.
type KV struct {
	mu   sync.Mutex
	data map[string][]byte
}

func NewKV() *KV {
	return &KV{data: map[string][]byte{}}
}

func (f *KV) KVGet(key string) ([]byte, *model.AppError) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if v, ok := f.data[key]; ok {
		return bytes.Clone(v), nil
	}
	return nil, nil
}

func (f *KV) KVSetWithOptions(key string, value []byte, options model.PluginKVSetOptions) (bool, *model.AppError) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if options.Atomic {
		current, exists := f.data[key]
		if options.OldValue == nil && exists || options.OldValue != nil && (!exists || !bytes.Equal(current, options.OldValue)) {
			return false, nil
		}
	}
	if value == nil {
		delete(f.data, key)
	} else {
		f.data[key] = bytes.Clone(value)
	}
	return true, nil
}

func (f *KV) KVDelete(key string) *model.AppError {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.data, key)
	return nil
}

// Keys returns the sorted keys starting with prefix.
func (f *KV) Keys(prefix string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	keys := []string{}
	for k := range f.data {
		if strings.HasPrefix(k, prefix) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys
}

// Event is a published websocket event.
type Event struct {
	Event     string
	Payload   map[string]any
	Broadcast *model.WebsocketBroadcast
}

// Publisher records the websocket events.
type Publisher struct {
	mu     sync.Mutex
	events []Event
}

func (f *Publisher) PublishWebSocketEvent(event string, payload map[string]any, broadcast *model.WebsocketBroadcast) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, Event{event, payload, broadcast})
}

// Last returns the last event, or a zero Event.
func (f *Publisher) Last() Event {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.events) == 0 {
		return Event{}
	}
	return f.events[len(f.events)-1]
}
