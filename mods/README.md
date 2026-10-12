# mods/ — mod overlay packs (resource manifest)

A server lays mod packs over the clients' own art: `mods/<id>/mod.json` (`{ "name": "…", "version": "1.0" }`) next to
`mods/<id>/files/assets/…` — the same paths as the game's art (`assets/chars/…`, `assets/ui/…`). Packs apply in
folder-name order; a later pack wins for the same path.

The server hashes every file (sha256) and publishes the result at `GET /resources.json` (with its protocol version);
each welcome names that manifest's hash. Clients (desktop, Android, web) download only the files their shared
content-addressed cache does not have yet, from `GET /cas/<sha256>`, verify each against its hash, and apply that
server's overlay while connected to it. A client with a different protocol version is told the server is incompatible.
The 存储管理 page lists which server uses which packs. The headless server executable takes `--mods-dir <dir>`
(default `./mods`). Code: shared/resources.js, server/resources.js, public/js/resources.js.
