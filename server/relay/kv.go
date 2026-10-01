// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package relay

import (
	"encoding/json"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/pkg/errors"
)

// atomicUpdateAttempts is how many times a compare-and-set update is retried on conflicts.
const atomicUpdateAttempts = 10

// KV is the part of the plugin API used to store the documents (implemented by plugin.API).
type KV interface {
	KVGet(key string) ([]byte, *model.AppError)
	KVSetWithOptions(key string, value []byte, options model.PluginKVSetOptions) (bool, *model.AppError)
	KVDelete(key string) *model.AppError
}

func kvGet(kv KV, key string) ([]byte, error) {
	data, appErr := kv.KVGet(key)
	if appErr != nil {
		return nil, errors.Wrapf(appErr, "failed to get %s", key)
	}
	return data, nil
}

func kvSet(kv KV, key string, value []byte) error {
	if _, appErr := kv.KVSetWithOptions(key, value, model.PluginKVSetOptions{}); appErr != nil {
		return errors.Wrapf(appErr, "failed to set %s", key)
	}
	return nil
}

func kvDelete(kv KV, key string) error {
	if appErr := kv.KVDelete(key); appErr != nil {
		return errors.Wrapf(appErr, "failed to delete %s", key)
	}
	return nil
}

// kvGetJSON reads a JSON value into v, and returns whether it exists.
func kvGetJSON(kv KV, key string, v any) (bool, error) {
	data, err := kvGet(kv, key)
	if err != nil || data == nil {
		return false, err
	}
	if err := json.Unmarshal(data, v); err != nil {
		return false, errors.Wrapf(err, "failed to decode %s", key)
	}
	return true, nil
}

func kvSetJSON(kv KV, key string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return errors.Wrapf(err, "failed to encode %s", key)
	}
	return kvSet(kv, key, data)
}

// kvUpdateJSON atomically updates the JSON value of a key with compare-and-set, retrying on
// conflicts. update gets the current value (the zero value when the key doesn't exist) and returns
// whether to write it back.
func kvUpdateJSON[T any](kv KV, key string, update func(value *T) (bool, error)) error {
	for range atomicUpdateAttempts {
		old, err := kvGet(kv, key)
		if err != nil {
			return err
		}

		var value T
		if old != nil {
			if err = json.Unmarshal(old, &value); err != nil {
				return errors.Wrapf(err, "failed to decode %s", key)
			}
		}

		write, err := update(&value)
		if err != nil || !write {
			return err
		}

		data, err := json.Marshal(value)
		if err != nil {
			return errors.Wrapf(err, "failed to encode %s", key)
		}

		ok, appErr := kv.KVSetWithOptions(key, data, model.PluginKVSetOptions{Atomic: true, OldValue: old})
		if appErr != nil {
			return errors.Wrapf(appErr, "failed to set %s", key)
		}
		if ok {
			return nil
		}
	}
	return errors.Errorf("failed to update %s: too many concurrent updates", key)
}
