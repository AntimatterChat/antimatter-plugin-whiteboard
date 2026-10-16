# Whiteboard

An Antimatter plugin for collaborative whiteboards, compatible with
[Excalidraw](https://excalidraw.com): boards shared with a channel or kept personal, drawn on by
several people at once, with everyone's pointer visible.

## Features

- **Whiteboard app.** The Whiteboard icon of the app bar (a channel header button on servers
  without the app bar) opens a panel listing the boards shared with the current channel and your
  personal boards. Boards open in the panel (widen it with its expand button) or in full screen.
- **Channel and personal boards.** Every member of a channel can draw on its boards; they become
  read-only when the channel is archived. Personal boards are only visible to you. Boards are
  deleted by their creator or by the channel admins.
- **Excalidraw.** The whole Excalidraw editor (shapes, arrows, freehand, text, images, libraries,
  undo...), in the light or dark theme of the user. Under the Fusion web UI, the board is framed by
  the mockup's whiteboard markup and Excalidraw takes Fusion's accent color, surfaces and font.
- **Live collaboration.** Changes appear for everyone, with the pointers, names and selections of
  the others; changes made offline are sent when the connection is back.
- **History.** A version of each board is kept every 10 minutes or so while it's drawn on (the last
  20): preview and restore them from **Version history** (restoring is an edit, it can be undone).
- **Libraries.** Excalidraw's library panel holds your own shapes (kept in your browser) and the
  shared libraries: the server-wide ones, added by the system admins in the plugin's settings of the
  System Console, and those of the community (team) of the board, added by its admins from
  **Manage libraries** in a board's menu or in the library panel. A library is an `.excalidrawlib`
  file (version 1 or 2, 5 MB at most; 100 libraries and 20 MB per community, and for the server);
  only its drawable elements are kept (images and embedded web pages are left out). Excalidraw's
  "Browse libraries" (libraries.excalidraw.com) is replaced by these, and members are told to ask an
  admin.
- **Import and export.** Download a board as `.excalidraw`, PNG or SVG (also from Excalidraw's own
  menu); import an `.excalidraw` file (it replaces the board's content, for everyone).
- **Share in the channel** posts a card with a thumbnail of the board, which opens it.
- **Works offline from the internet.** Excalidraw and its fonts are shipped in the plugin; it
  doesn't load anything from a CDN, and never calls excalidraw.com or its services: the build
  (`webapp/excalidraw_offline_loader.js`) removes Excalidraw's links to them (library, publishing,
  help, social links, fonts' fallback) and fails if the bundle still names one. Web pages can't be
  embedded in boards.

## How it works

A board is a scene of Excalidraw elements. Like Excalidraw's own collaboration, clients send the
elements whose version changed, and every client, and the server, reconciles elements the same
way: per element, the higher version wins, then the lower version nonce. The server keeps an
append-only log of the scene updates of each board in the plugin KV store, merges them into a
snapshot every 200 updates or MiB (deleted elements are kept a day, then dropped), and relays the
updates and the pointers to the members of the board's channel (or to its owner) with websocket
events. Images are stored beside the board (8 MiB each at most), and a PNG thumbnail is saved when
the drawing stops, for the cards of shared boards. Each user can send twenty updates and forty
pointer moves a second on average (in bursts of 60 and 80), per server; beyond that the relay
answers 429 and clients send the update again a moment later.

The relay is shared with the notes plugin: `server/relay` and `webapp/src/relay` are copied in both
repositories and must be kept in sync.

Excalidraw is large: the webapp loads it, in separate chunks served next to the plugin bundle,
only when a board is opened.

REST API, under `/plugins/com.antimatterchat.whiteboard/api/v1`: the relay's `/docs` routes (see
the notes plugin's README), plus:

| Method and path | |
| --- | --- |
| `GET`, `PUT /docs/{id}/files/{file_id}` | an image of the board (`{"mimeType", "dataURL", "created"}`) |
| `GET`, `PUT /docs/{id}/thumbnail` | the PNG thumbnail of the board |
| `POST /docs/{id}/share` | post a card linking to the board in its channel |
| `GET /libraries?channel_id=&team_id=` | the server's libraries, and those of the channel's team (or of `team_id` for direct messages and personal boards), with whether the user manages them |
| `POST /libraries` | add a library: multipart form with `file` (the `.excalidrawlib`), `name` and `team_id` (none for a server-wide library) |
| `GET /libraries/{id}/items` | the items of a library, as an `.excalidrawlib` file |
| `PATCH`, `DELETE /libraries/{id}` | rename (`{"name"}`) or delete a library |

Libraries are added, renamed and deleted by the system admins (server-wide ones, and any
community's) and by the admins of a team (its own: the *Manage team* permission); the changes are
recorded in the audit log.

## Trying it with two users

With `run-local.sh` (`PLUGINS="whiteboard" ./run-local.sh plugins`, then `run`), log in as alice in
one browser and bob in another (or a private window), open the same channel, click the Whiteboard
icon of the app bar, create a board in the channel as alice and open it as bob: what one draws
appears for the other, with their pointer. Reload a window: the board is still there.

## Development

```sh
make dist      # build the plugin bundle in dist/
make test      # run the server and webapp tests
make check-style
```

The webpack build of the webapp needs about 3 GB of memory. Set
`MM_SERVICESETTINGS_ENABLEDEVELOPER=true` to only build the server for the current platform.

## Documentation

See the [user guide](https://antimatter.chat/docs/users/apps.html#whiteboard) and the
[admin guide](https://antimatter.chat/docs/admins/apps.html#kanban-notes) on
[antimatter.chat/docs](https://antimatter.chat/docs/).

## Releases

Pushing a `v*` tag builds the app and publishes it as a
[GitHub release](https://github.com/AntimatterChat/antimatter-plugin-whiteboard/releases) ([release workflow](.github/workflows/release.yml),
using the organisation's shared
[app release workflow](https://github.com/AntimatterChat/.github/blob/main/.github/workflows/app-release.yml)).
The version is the tag without its `v`. Tags with a `-`, such as `v1.2.0-rc.1`, are published as prereleases. Each release has:

- `com.antimatterchat.whiteboard-<version>.tar.gz`: the app bundle, with the server for Linux (amd64, arm64), macOS (amd64, arm64) and Windows (amd64)
- `com.antimatterchat.whiteboard-<version>.tar.gz.sig`: its detached signature with the Antimatter plugin signing key
- `SHA256SUMS`: the checksums of the release files

Install the bundle with **Upload Plugin** in **System Console > Plugins > Plugin Management** or
`amctl plugin install-url <bundle URL>` (both need `AM_PLUGINSETTINGS_ENABLEUPLOADS=true`), see
[Installing other apps](https://antimatter.chat/docs/admins/apps.html). A release without `.sig`
files is unsigned (its notes say so): a server with Require Plugin Signature
(`PluginSettings.RequirePluginSignature`) on refuses it. Running the workflow by hand (*Actions* → *Release* → *Run workflow*)
builds the bundle as a workflow artifact, and as a draft prerelease if you tick the box; builds
of untagged commits are versioned after the latest tag and the commit.

## Feedback and support

Found a bug in the Whiteboard plugin, or missing a feature? Please [open an
issue](https://github.com/AntimatterChat/community/issues/new/choose) in the [Antimatter community
repository](https://github.com/AntimatterChat/community), where the feedback for every part of
Antimatter is gathered. Questions and ideas are welcome in its
[Discussions](https://github.com/AntimatterChat/community/discussions). Please report security
problems privately, as explained in the [security
policy](https://github.com/AntimatterChat/.github/blob/main/SECURITY.md).

## License

GNU Affero General Public License v3.0, see [LICENSE.txt](LICENSE.txt). The build tooling is derived
from Apache-2.0 licensed Mattermost plugins; Excalidraw (MIT) and its fonts are bundled, see
[NOTICE.txt](NOTICE.txt).
