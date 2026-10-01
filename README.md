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
- **Import and export.** Download a board as `.excalidraw`, PNG or SVG (also from Excalidraw's own
  menu); import an `.excalidraw` file (it replaces the board's content, for everyone).
- **Share in the channel** posts a card with a thumbnail of the board, which opens it.
- **Works offline from the internet.** Excalidraw and its fonts are shipped in the plugin; it
  doesn't load anything from a CDN.

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

## License

GNU Affero General Public License v3.0, see [LICENSE.txt](LICENSE.txt). The build tooling is derived
from Apache-2.0 licensed Mattermost plugins; Excalidraw (MIT) and its fonts are bundled, see
[NOTICE.txt](NOTICE.txt).
