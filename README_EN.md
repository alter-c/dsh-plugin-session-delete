<div align="center">

# dsh-plugin-session-delete · Delete Session

**Adds Delete session to DeepSeek Harness (DSH), removing session logs, projection caches, and referenced attachments.**

[中文](README.md) · English

[![version](https://img.shields.io/badge/version-0.1.0-blue)](package.json)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)

</div>

---

> [!WARNING]
> Deletion is irreversible. Attachments are not reference-counted across sessions: shared attachments are deleted even if another session still uses them.

## Installation

Requires Node.js ≥ 22 and DeepSeek Harness. In the DSH sidebar, open **Plugins → Add plugin** and enter:

```text
github:alter-c/dsh-plugin-session-delete
```

DSH fetches and packs the repository automatically. To update, uninstall and reinstall.

Local source and offline packages are also supported (replace the examples with actual absolute paths):

| Method | Input | Apply changes |
| --- | --- | --- |
| Local source | `link:D:/path/to/dsh-plugin-session-delete` | Reload the plugin; client changes may also need a page refresh |
| Offline package | `D:/path/to/dsh-plugin-session-delete-0.1.0.tgz` | Repack and reinstall |

Uninstalling a local link on Windows may leave a junction behind.

## Usage

Find a session in the sidebar, open its `…` menu, choose **Delete session** below **Archive session**, and confirm in the dialog.

The plugin first attempts to stop running work, then removes files, clears session references across all workspaces, and refreshes the list. Step failures are collected as `warnings`, so deletion may be partial.

## Cleanup scope

`$DSH_HOME` defaults to `~/.dsh`. Session logs and attachments use their service's configured root when available.

| Data | Default location (relative to `$DSH_HOME`) |
| --- | --- |
| Session log directory | `sessions/<projectKey>/<encodedId>/` |
| Projection cache and backups | `storages/session_projcache/sessions/<id>.json`, `.json.bak.*` |
| Referenced image and file attachments | Corresponding objects in `objects/`, `files/`, and `file-objects/` under `attachments/v1/` |

The request-image cache (`cache/attachments/`) is retained. Session IDs and deletion paths are validated.

## Development

- `lib/index.js`: host deletion logic and authenticated HTTP route, using only Node.js built-ins.
- `lib/client.js`: browser menu item and confirmation dialog.
- `locale/`: Chinese and English metadata.

For a local `link:` install, toggle the plugin off and on or restart DSH to reload. For offline distribution, run `npm pack` in the project directory to generate a `.tgz`.

### HTTP API

```http
POST /api/session.delete
Content-Type: application/json

{"sessionId":"<session ID>"}
```

Responses include `ok`, `sessionId`, `removed`, `warnings`, and `formatVersion`. Status codes: `200` session found and processing completed (possibly with warnings), `400` invalid request, `404` session not found, `405` unsupported method, `500` processing error. Error responses include `error`.

## Acknowledgements

Thanks to the DeepSeek Harness plugin system and to `@deepseek-ai/dsh-session-log-export` for the attachment-enumeration implementation this plugin mirrors.
