<div align="center">

# dsh-plugin-session-delete · Delete Session

**Fills the missing "delete session" capability in DeepSeek Harness — permanently remove a Session from the sidebar and clean up the durable files it leaves on disk.**

[中文](README.md) · English

[![version](https://img.shields.io/badge/version-0.1.0-blue)](package.json)
[![license](https://img.shields.io/badge/license-MIT-green)](#license)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)
[![github](https://img.shields.io/badge/github-alter--c%2Fdsh--plugin--session--delete-181717?logo=github)](https://github.com/alter-c/dsh-plugin-session-delete)

</div>

---

> [!WARNING]
> Deletion is **irreversible**. Once confirmed, the Session and its log, projection cache, and referenced attachments are permanently removed from disk and cannot be recovered.

## Introduction

DeepSeek Harness (DSH) ships *archive* but not *delete* — a Session can be hidden from the list, yet its log files stay on disk forever. This plugin fills that gap for one-task-per-session use:

- Adds a **Delete session** action to every Session's `…` menu, right below **Archive session**, with a separator and danger styling;
- Opens a confirmation dialog styled after *Delete workspace*;
- On confirm, the Session leaves the sidebar and its log, projection cache, and referenced attachments are removed.

## Features

- **Natural placement**: registered on the Session `…` menu, directly below the built-in *Archive*, with a separator and danger icon.
- **Confirmation dialog**: reuses the official `Modal` / `Button` primitives to match *Delete workspace*, with a danger-colored confirm button, a pending state, and an inline error.
- **Safe stop**: a running Session is stopped first via the built-in mechanism (`archiveSession({ stopActivity: true })`) to avoid a dirty state.
- **Thorough cleanup**: removes the Session log, projection cache, and referenced attachments, and clears every workspace accounting reference.
- **Path-escape protection**: every path is validated for Session-ID safety and root containment before touching the filesystem.
- **Fault-tolerant feedback**: failures during each deletion step are collected as `warnings` and returned to the client instead of aborting.
- **Zero host dependencies**: the host half uses only Node.js built-ins, so the package installs with no first-party dependencies.

## Installation

DSH's plugin page (sidebar **Plugins** → **Add plugin**) accepts a package name, a Git address, a tarball, or an absolute local path, so this plugin has three install routes.

### Install from GitHub (recommended)

```text
github:alter-c/dsh-plugin-session-delete
```

DSH clones the repository and packs it automatically according to this package's `files` field — **no manual packing**.

Two things to know:

- **There is no auto-update.** A git dependency is resolved to a concrete commit at install time, so once new commits land you must **uninstall and install again** to pick them up (DSH does not support plugin auto-update yet);
- **For a private setup or when GitHub is hard to reach**, use the SSH form so your local SSH key applies directly:

  ```text
  git@github.com:alter-c/dsh-plugin-session-delete.git
  ```

### Install from local source (development)

Symlink the plugin directory into the profile: the source tree *is* the running code, so edits need neither packing nor reinstall.

```text
link:D:/Code/project/deepseek harness plugin/dsh-plugin-session-delete
```

This is a development mode:

- host-side edits take effect only after the plugin reloads (toggle the `session-delete` row off and on in the plugin page, or restart DSH); client-side edits may additionally need a page refresh;
- on Windows, uninstalling may leave a junction behind.

### Install from a tarball (offline / intranet)

Enter the packed artifact path in the plugin page:

```text
D:/Code/project/deepseek harness plugin/dsh-plugin-session-delete-0.1.0.tgz
```

The tarball is a snapshot, so re-pack and reinstall after every source change.

## Usage

1. Open the DSH sidebar and find the target Session.
2. Click the `…` menu on that Session.
3. Choose **Delete session**, located below *Archive session*.
4. Confirm by clicking **Delete session** in the dialog (*Cancel* makes no changes).

If the Session is running, the plugin stops it safely before deleting.

## How it works

### Architecture

The plugin is split into two halves connected by an authenticated Fetch route:

| Half | File | Runtime | Responsibility |
| --- | --- | --- | --- |
| Host | `lib/index.js` | DSH main process (Node.js) | Actual deletion logic + HTTP route |
| Client | `lib/client.js` | Browser | Menu item + confirmation dialog |

The client half registers two slots:

- `sidebar.workspaces.session.menu.item` (id `session-delete.delete`, order `500`): renders the *Delete session* menu item;
- `shell.overlay` (id `session-delete.confirm`): renders the confirmation dialog.

### Deletion flow

One deletion runs in this order:

1. **Read the Session header** via `sessionPersistence.stat` to obtain its `cwd`, which selects the project directory that owns the log.
2. **Stop running work** by calling `workspaceRegistry.archiveSession(sessionId, { stopActivity: true })`, reusing the built-in stop mechanism.
3. **Enumerate attachment references** by reading the Session's committed events before the log is removed.
4. **Remove durable files** — the Session log directory, projection cache, and attachment objects — each step guarded by path-escape checks.
5. **Clear accounting references** across every workspace via `detachSession` / `unarchiveSession` / `unpinSession`.
6. **Refresh the view** by emitting `api-session/removed`, which removes the row from the sidebar.

### What gets deleted

`$DSH_HOME` is the environment variable, defaulting to `~/.dsh`.

| Data | Location | Notes |
| --- | --- | --- |
| Session log | `$DSH_HOME/sessions/<projectKey>/<id>/session.v4.jsonl.zstd` | JSONL primary record of Session events (zstd-compressed) |
| Projection cache | `$DSH_HOME/storages/session_projcache/sessions/<id>.json` (plus `.bak.*`) | Session projection-cache documents |
| Image attachments | `$DSH_HOME/attachments/v1/objects/<2-hex>/<digest>` | Image objects referenced by the Session |
| File attachments | `$DSH_HOME/attachments/v1/files/<2-hex>/<digest>/` and `file-objects/<2-hex>/<digest>` | File objects referenced by the Session (aliased leaf + canonical object) |

### Intentionally kept or not cleaned

- **Request-image cache** (`~/.dsh/cache/attachments/`): a regenerable derived cache, intentionally left in place.
- **Search index**: mounted in-memory (`:memory:`), so no cleanup is needed.

## HTTP API

The plugin registers one authenticated route via `connection.fetch.register`:

```text
POST /api/session.delete
```

**Request body**

```json
{ "sessionId": "<session id>" }
```

**Responses**

| Status | Case | Body |
| --- | --- | --- |
| `200` | Deletion succeeded | `{ "ok": true, "sessionId", "removed": [...], "warnings": [...], "formatVersion": 4 }` |
| `404` | Session not found | `{ "ok": false, "sessionId", "error": "session-not-found", ... }` |
| `400` | Malformed body / invalid Session id | `{ "ok": false, "error": "invalid-json" \| "invalid-session-id" }` |
| `405` | Non-POST method | `{ "ok": false, "error": "method-not-allowed" }` |
| `500` | Unhandled error | `{ "ok": false, "sessionId", "error": "<message>" }` |

## Security and scope

- **Session-ID validation**: only accepts a non-empty id of at most 512 chars, not `.` / `..`, and containing no path separators or null byte (`isSafeSessionId`).
- **Path-escape protection**: every path must fall inside the expected root (session / storage / attachment root) (`isInside`), so a malformed id cannot escape the storage tree.
- **No cross-Session reference counting**: attachments are content-addressed and shared between Sessions (e.g. forked sub-sessions). By design this plugin does **not** reference-count — attachments die with their Session. If the same attachment is referenced elsewhere, it is still removed. This is intentional; make sure it matches your usage.
- **Fault tolerance**: failures are collected as `warnings` rather than thrown, so the client can report exactly which step failed.

## Development

### Prerequisites

- Node.js ≥ 22
- DeepSeek Harness (providing `connection`, `sessionPersistence`, `workspaceRegistry`, etc.)

### Project structure

```text
dsh-plugin-session-delete/
├── lib/
│   ├── index.js      # Host half: deletion logic + HTTP route
│   └── client.js     # Client half: menu item + confirmation dialog
├── locale/
│   ├── zh.json       # Chinese metadata (title / description)
│   └── en.json       # English metadata
├── cordis.patch.yml  # Bundle patch: registers this plugin only
├── package.json      # Package manifest
├── README.md         # Chinese documentation
├── README_EN.md      # English documentation
└── .gitignore        # Ignores node_modules and packed artifacts
```

### Development and release

The three install routes map to three workflows:

| Situation | What to do |
| --- | --- |
| Day-to-day edits | Use the local `link:` install above; reload the plugin after editing — no packing |
| Publish a new version | Commit and push to GitHub; users uninstall and then reinstall `github:alter-c/dsh-plugin-session-delete` |
| Offline distribution | Double-click `pack.cmd` next to the plugin folder; it produces `dsh-plugin-session-delete-0.1.0.tgz` |

The tarball is a snapshot, so when you distribute that way you must re-pack and reinstall after every change.

### Testing

The core deletion logic (path derivation, the full deletion flow, route wiring and input validation, attachment enumeration) is verified by automated tests using an isolated `$DSH_HOME` and stubbed Cordis services — 23 tests in total. Test files are not shipped in the tarball (see the `files` field in `package.json`).

## License

[MIT](package.json)

## Acknowledgements

Thanks to the DeepSeek Harness plugin system and to `@deepseek-ai/dsh-session-log-export` for the attachment-enumeration implementation this plugin mirrors.
