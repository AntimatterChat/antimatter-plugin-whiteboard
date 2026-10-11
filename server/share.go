// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"fmt"

	"github.com/mattermost/mattermost/server/public/model"

	"github.com/antimatterchat/antimatter-plugin-whiteboard/server/relay"
)

// shareMessage is the message of the post sharing a whiteboard in its channel, by default.
func shareMessage(title string) string {
	return fmt.Sprintf("Shared a whiteboard: **%s**", escapeMarkdown(title))
}

// sharePost is the post sharing a whiteboard in its channel.
func sharePost(userID string, doc *relay.Doc, message string) *model.Post {
	if message == "" {
		message = shareMessage(doc.Title)
	}
	post := &model.Post{
		UserId:    userID,
		ChannelId: doc.ChannelID,
		Message:   message,
		Type:      boardPostType,
	}
	post.AddProp("doc_id", doc.ID)
	post.AddProp("title", doc.Title)
	return post
}

// recordShared remembers the post sharing a document, the first one only. It returns the document as
// it is then, and whether the post is the one remembered.
func (p *Plugin) recordShared(doc *relay.Doc, postID string) (*relay.Doc, bool) {
	first := false
	updated, err := p.service.Docs.Update(doc.ID, func(d *relay.Doc) bool {
		if d.SharedPostID != "" {
			return false
		}
		d.SharedPostID = postID
		first = true
		return true
	})
	if err != nil || updated == nil {
		return doc, false
	}
	return updated, first
}

// shareTitled shares a channel's whiteboard in its channel as soon as it has a title: once, then its card
// follows its title.
func (p *Plugin) shareTitled(userID string, doc *relay.Doc) *relay.Doc {
	if doc.IsPersonal() || doc.Title == "" || doc.Title == p.service.DefaultTitle {
		return doc
	}

	if doc.SharedPostID != "" {
		post, appErr := p.API.GetPost(doc.SharedPostID)
		if appErr != nil || post.DeleteAt != 0 {
			return doc
		}
		oldTitle, _ := post.GetProp("title").(string)
		if oldTitle == doc.Title {
			return doc
		}
		if post.Message == shareMessage(oldTitle) {
			post.Message = shareMessage(doc.Title)
		}
		post.AddProp("title", doc.Title)
		if _, appErr = p.API.UpdatePost(post); appErr != nil {
			p.API.LogWarn("Failed to rename the card of a shared whiteboard", "doc_id", doc.ID, "err", appErr.Error())
		}
		return doc
	}

	if !p.API.HasPermissionToChannel(userID, doc.ChannelID, model.PermissionCreatePost) {
		return doc
	}
	post, appErr := p.API.CreatePost(sharePost(userID, doc, ""))
	if appErr != nil {
		p.API.LogWarn("Failed to share a whiteboard in its channel", "doc_id", doc.ID, "err", appErr.Error())
		return doc
	}
	updated, first := p.recordShared(doc, post.Id)
	if !first {
		// Shared meanwhile: one card is enough
		_ = p.API.DeletePost(post.Id)
	}
	return updated
}
