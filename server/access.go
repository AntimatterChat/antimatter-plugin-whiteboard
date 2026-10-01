// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"net/http"

	"github.com/mattermost/mattermost/server/public/model"

	"github.com/antimatterchat/antimatter-plugin-whiteboard/server/relay"
)

// channelAPI is the part of the plugin API used to check channel permissions.
type channelAPI interface {
	GetChannel(channelID string) (*model.Channel, *model.AppError)
	GetChannelMember(channelID, userID string) (*model.ChannelMember, *model.AppError)
	HasPermissionToChannel(userID, channelID string, permission *model.Permission) bool
}

// channelAccess gives the members of a channel access to its boards: they edit them, or only read
// them once the channel is archived.
type channelAccess struct {
	api channelAPI
}

func (a channelAccess) ChannelPermission(userID, channelID string) (relay.Permission, error) {
	if _, appErr := a.api.GetChannelMember(channelID, userID); appErr != nil {
		if appErr.StatusCode == http.StatusNotFound {
			return relay.NoAccess, nil
		}
		return relay.NoAccess, appErr
	}

	channel, appErr := a.api.GetChannel(channelID)
	if appErr != nil {
		return relay.NoAccess, appErr
	}
	if channel.DeleteAt != 0 {
		return relay.ReadOnly, nil
	}
	return relay.ReadWrite, nil
}

func (a channelAccess) CanManageChannel(userID, channelID string) bool {
	channel, appErr := a.api.GetChannel(channelID)
	if appErr != nil {
		return false
	}

	var permission *model.Permission
	switch channel.Type {
	case model.ChannelTypeOpen:
		permission = model.PermissionManagePublicChannelProperties
	case model.ChannelTypePrivate:
		permission = model.PermissionManagePrivateChannelProperties
	default:
		// Nobody manages direct and group messages: only creators delete their boards there
		return false
	}
	return a.api.HasPermissionToChannel(userID, channelID, permission)
}
