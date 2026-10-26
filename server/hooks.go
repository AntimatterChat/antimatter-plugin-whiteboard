// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"

	"github.com/antimatterchat/antimatter-plugin-whiteboard/server/relay"
)

// sharedDoc returns the document a card links to if the user can share it in the post's channel:
// a document of that channel the user can edit, as sharing asks.
func (p *Plugin) sharedDoc(post *model.Post, docID string) *relay.Doc {
	if p.service == nil || !model.IsValidId(docID) {
		return nil
	}
	doc, err := p.service.Docs.Get(docID)
	if err != nil || doc == nil || doc.IsPersonal() || doc.ChannelID != post.ChannelId {
		return nil
	}
	permission, err := p.service.DocPermission(post.UserId, doc)
	if err != nil || permission != relay.ReadWrite {
		return nil
	}
	return doc
}

// MessageWillBePosted only lets cards of boards be posted for a board of the channel the poster
// can share, with the board's own title: anyone can post any type of post through the REST API, and
// the card shows the title of its props.
func (p *Plugin) MessageWillBePosted(_ *plugin.Context, post *model.Post) (*model.Post, string) {
	if post.Type != boardPostType {
		return post, ""
	}
	docID, _ := post.GetProp("doc_id").(string)
	doc := p.sharedDoc(post, docID)
	if doc == nil {
		return nil, "Board cards can only be posted by sharing a board of the channel."
	}
	post.AddProp("title", doc.Title)
	return post, ""
}

// MessageWillBeUpdated keeps the cards of boards tied to their board, with its title, and other posts
// from becoming cards.
func (p *Plugin) MessageWillBeUpdated(_ *plugin.Context, newPost, oldPost *model.Post) (*model.Post, string) {
	if oldPost.Type != boardPostType {
		if newPost.Type == boardPostType {
			return nil, "Messages can't be turned into board cards."
		}
		return newPost, ""
	}
	newPost.Type = boardPostType
	docID := oldPost.GetProp("doc_id")
	newPost.AddProp("doc_id", docID)
	title := oldPost.GetProp("title")
	if id, _ := docID.(string); p.service != nil && model.IsValidId(id) {
		if doc, err := p.service.Docs.Get(id); err == nil && doc != nil {
			title = doc.Title
		}
	}
	newPost.AddProp("title", title)
	return newPost, ""
}
