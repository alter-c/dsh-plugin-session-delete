/**
 * Host half of `dsh-plugin-session-delete`.
 *
 * Deleting a Session is deliberately stronger than archiving: the Session
 * leaves every grouping surface AND its durable artifacts are removed.
 *
 * DSH ships no deletion seam — `sessionPersistence` exposes only
 * `create`/`open`/`flush`/`stat`/`list`, and the `fs` service deliberately has
 * no unlink — so this plugin performs the removal itself. It imports only
 * Node builtins so the package stays installable without first-party
 * dependencies.
 *
 * The durable layout it targets (verified against the mounted backends):
 *
 * ```text
 * $DSH_HOME/sessions/<--project-key-->/><encoded-id>/session.vN.jsonl.zstd
 * $DSH_HOME/storages/session_projcache/sessions/<id>.json
 * ```
 *
 * Attachment objects under `$DSH_HOME/attachments/v1` are content-addressed
 * and shared between Sessions, so they are retained unless the caller opts in
 * with `pruneAttachments`.
 *
 * @module dsh-plugin-session-delete
 */
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { readdir, rm, stat } from 'node:fs/promises'

/** Cordis plugin name. */
export const name = 'sessionDelete'

/**
 * The authenticated Fetch carrier is the only hard dependency; every storage
 * service below is read opportunistically so a trimmed composition still
 * loads the plugin.
 */
export const inject = ['connection']

/** Route the browser half POSTs one deletion request to. */
export const SESSION_DELETE_PATH = '/api/session.delete'

/** Label recorded for the route's disposal effect. */
const ROUTE_LABEL = 'session-delete: browser delete route'

/** Generation suffix retained by the JSONL backend (v4 is the current format). */
const SESSION_FORMAT_VERSION = 4

// ---------------------------------------------------------------------------
// DSH home and the durable layout
// ---------------------------------------------------------------------------

/**
 * Resolve the DeepSeek Harness home exactly as `@deepseek-ai/dsh-home-paths`
 * does: `$DSH_HOME` when it carries content, otherwise `~/.dsh`.
 * @param env - environment mapping, injectable for tests.
 * @returns the absolute harness home.
 */
export function dshHome(env = process.env) {
  const fromEnv = env?.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return resolve(fromEnv)
  return join(homedir(), '.dsh')
}

/**
 * Join path segments onto the resolved harness home.
 * @param segments - segments appended to the harness home.
 * @returns the absolute joined path.
 */
export function dshHomePath(...segments) {
  return join(dshHome(), ...segments)
}

/**
 * Encode one string into a single filesystem-safe path segment, mirroring the
 * JSONL backend's `encodeSegment` so a derived path matches what it wrote.
 * @param raw - the non-empty string to encode.
 * @returns the escaped single path segment.
 */
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < raw.length; index++) {
    const code = raw.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character !== '~' && /^[A-Za-z0-9._-]$/.test(character)) out += character
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/**
 * Build the readable project directory key for one project path, mirroring the
 * JSONL backend's `projectKey`.
 * @param cwd - the Session's project directory.
 * @returns a single filesystem-safe project directory name.
 */
export function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index++) {
    const code = cwd.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character === '/' || character === '\\' || character === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (character !== '~' && /^[A-Za-z0-9._-]$/.test(character)) {
      readable += character
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/**
 * Candidate Session-log roots, most authoritative first: the live backend's
 * configured root, then the default harness location.
 * @param persistence - the mounted persistence service, when present.
 * @returns distinct absolute root directories.
 */
export function sessionRoots(persistence) {
  const roots = []
  const configured = persistence?.root
  if (typeof configured === 'string' && configured.length > 0) roots.push(resolve(configured))
  roots.push(resolve(dshHomePath('sessions')))
  return [...new Set(roots)]
}

/**
 * Whether a path is an existing directory.
 * @param target - absolute path to test.
 * @returns true when the path exists and is a directory.
 */
async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Locate one Session's on-disk directory.
 *
 * The derived path is authoritative; the scan is the safety net that keeps a
 * layout drift from silently orphaning an artifact instead of deleting it.
 * @param roots - candidate Session-log roots.
 * @param cwd - the Session's project directory, when known.
 * @param id - the Session id.
 * @returns the absolute Session directory, or `undefined`.
 */
export async function findSessionDir(roots, cwd, id) {
  const encoded = encodeSegment(id)
  const names = new Set([encoded, id])

  if (typeof cwd === 'string' && cwd.length > 0) {
    const project = projectKey(cwd)
    for (const root of roots) {
      for (const candidate of names) {
        const direct = join(root, project, candidate)
        if (await isDirectory(direct)) return direct
      }
    }
  }

  for (const root of roots) {
    let projects
    try {
      projects = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const project of projects) {
      if (!project.isDirectory()) continue
      for (const candidate of names) {
        const directory = join(root, project.name, candidate)
        if (await isDirectory(directory)) return directory
      }
    }
  }
  return undefined
}

/**
 * Every projection-cache document owned by one Session, including the
 * quarantined `.bak` copies the storage domain moves aside.
 * @param id - the Session id.
 * @returns absolute document paths.
 */
export async function projectionCacheFiles(id) {
  const directory = dshHomePath('storages', 'session_projcache', 'sessions')
  let entries
  try {
    entries = await readdir(directory)
  } catch {
    return []
  }
  const keys = new Set([id, encodeSegment(id)])
  const exact = new Set()
  const prefixes = []
  for (const key of keys) {
    exact.add(`${key}.json`)
    prefixes.push(`${key}.json.bak.`)
  }
  return entries
    .filter((entry) => exact.has(entry) || prefixes.some((prefix) => entry.startsWith(prefix)))
    .map((entry) => join(directory, entry))
}

/**
 * Whether a candidate artifact is genuinely inside one of the expected roots,
 * which keeps a malformed id from escaping the storage tree.
 * @param candidate - absolute artifact path.
 * @param roots - absolute roots the artifact must live under.
 * @returns true when containment holds.
 */
export function isInside(candidate, roots) {
  const target = resolve(candidate)
  return roots.some((root) => {
    const base = resolve(root)
    return target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)
  })
}

/**
 * Whether an id is safe to turn into a storage path segment.
 * @param id - candidate Session id.
 * @returns true when the id is a plausible non-empty identifier.
 */
export function isSafeSessionId(id) {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 512 &&
    id !== '.' &&
    id !== '..' &&
    !id.includes('/') &&
    !id.includes('\\') &&
    !id.includes('\0')
  )
}

/**
 * Human-readable message for an unknown thrown value.
 * @param error - the thrown value.
 * @returns a message string.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Resolve the attachment store root: the live backend's configured root, or
 * the default harness location (`$DSH_HOME/attachments/v1`).
 * @param attachments - the mounted attachment service, when present.
 * @returns the absolute attachment root.
 */
export function attachmentsRoot(attachments) {
  const configured = attachments?.root
  if (typeof configured === 'string' && configured.length > 0) return resolve(configured)
  return dshHomePath('attachments', 'v1')
}

/**
 * Extract the 64-hex digest from an `sha256:` attachment id, or `undefined`
 * when the id is not a well-formed content address.
 * @param ref - an attachment reference.
 * @returns the lowercase digest, or `undefined`.
 */
function attachmentDigest(ref) {
  const id = typeof ref?.attachmentId === 'string' ? ref.attachmentId : ''
  const digest = id.startsWith('sha256:') ? id.slice(7) : id
  return /^[a-f0-9]{64}$/.test(digest) ? digest : undefined
}

/**
 * Collect direct attachment blocks from one declared V4 content array.
 *
 * This mirrors `@deepseek-ai/dsh-session-log-export`, so both agree on where an
 * image/file reference may appear and no opaque payload field is interpreted.
 * @param content - an event or message content array.
 * @param images - image map keyed by attachment id.
 * @param files - file map keyed by attachment id.
 */
function collectAttachmentRefs(content, images, files) {
  if (!Array.isArray(content)) return
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value
    if (block.type === 'image' && typeof block.attachment === 'object' && block.attachment !== null) {
      images.set(String(block.attachment.attachmentId), block.attachment)
    }
    if (block.type === 'file' && typeof block.attachment === 'object' && block.attachment !== null) {
      files.set(String(block.attachment.attachmentId), block.attachment)
    }
  }
}

/**
 * Collect references from one committed Session event, walking only the
 * declared first-party content fields and completed Assistant blocks.
 * @param event - one Session event.
 * @param images - image map keyed by attachment id.
 * @param files - file map keyed by attachment id.
 */
function collectEventAttachmentRefs(event, images, files) {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return
  const data = event.data
  if (typeof data !== 'object' || data === null) return
  const carrier = data
  switch (event.type) {
    case 'user/message':
    case 'tool/ptc-dispatch':
      collectAttachmentRefs(carrier.content, images, files)
      return
    case 'system/message':
    case 'developer/message':
    case 'tool/result':
    case 'team/message/queued':
      collectAttachmentRefs(carrier.message?.content, images, files)
      return
    case 'agent/inbox/spliced': {
      const messages = carrier.inserted
      if (!Array.isArray(messages)) return
      for (const message of messages) {
        if (typeof message !== 'object' || message === null || Array.isArray(message)) continue
        collectAttachmentRefs(message.content, images, files)
      }
      return
    }
    case 'compaction/summary':
      collectAttachmentRefs(carrier.summary, images, files)
      collectAttachmentRefs(carrier.rawOutput, images, files)
      return
    case 'assistant/message':
      collectAttachmentRefs(carrier.message?.content, images, files)
      break
    case 'assistant/attempt':
      break
    default:
      return
  }
  if (carrier.stream !== undefined) {
    for (const record of carrier.stream) {
      if (record.type === 'chunk' && record.chunk?.type === 'block-end') {
        collectAttachmentRefs([record.chunk.block], images, files)
      }
    }
  }
}

/**
 * Collect the distinct attachment references from a Session's committed events.
 * @param events - the Session's committed events.
 * @returns image and file maps keyed by attachment id.
 */
export function collectSessionAttachments(events) {
  const images = new Map()
  const files = new Map()
  for (const event of events) collectEventAttachmentRefs(event, images, files)
  return { images, files }
}

/**
 * The attachment-store paths one Session's references occupy. Image digests
 * land under `objects/`; file digests land under `files/<digest>/` (the aliased
 * leaf directory) and `file-objects/<digest>` (the canonical object).
 * @param refs - image and file maps from {@link collectSessionAttachments}.
 * @param root - the attachment store root.
 * @returns absolute paths to remove.
 */
export function attachmentPathsFor(refs, root) {
  const paths = []
  const images = new Set()
  const files = new Set()
  for (const ref of refs.images.values()) {
    const digest = attachmentDigest(ref)
    if (digest === undefined || images.has(digest)) continue
    images.add(digest)
    paths.push(join(root, 'objects', digest.slice(0, 2), digest))
  }
  for (const ref of refs.files.values()) {
    const digest = attachmentDigest(ref)
    if (digest === undefined || files.has(digest)) continue
    files.add(digest)
    paths.push(join(root, 'files', digest.slice(0, 2), digest))
    paths.push(join(root, 'file-objects', digest.slice(0, 2), digest))
  }
  return paths
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/**
 * Delete one Session: stop its running work, drop every reference that keeps
 * it grouped, remove its durable artifacts, and refresh the browser catalog.
 *
 * Failures are collected rather than thrown so a partial removal still
 * reports exactly which step failed, and the client can surface it.
 * @param ctx - the plugin's Cordis context.
 * @param sessionId - the Session to delete.
 * @returns a JSON-serializable outcome.
 */
export async function deleteSession(ctx, sessionId) {
  const warnings = []
  const removed = []
  const persistence = ctx.get('sessionPersistence')
  const registry = ctx.get('workspaceRegistry')

  // 1. Read the stored header while the log still exists: its cwd selects the
  //    project directory that owns the artifact.
  let cwd
  let known = false
  if (persistence !== undefined) {
    try {
      const snapshot = await persistence.stat(sessionId)
      if (snapshot !== undefined) {
        known = true
        cwd = snapshot.header?.cwd
      }
    } catch (error) {
      warnings.push(`stat failed: ${messageOf(error)}`)
    }
  }

  // 2. Stop running work and hide the Session through the shipped archive
  //    path, which owns the activity waterfall and the stop fan-out.
  if (registry !== undefined) {
    try {
      await registry.archiveSession(sessionId, { stopActivity: true })
    } catch (error) {
      warnings.push(`stop failed: ${messageOf(error)}`)
    }
  }

  // 3. Read the Session's committed events before its log is removed, and
  //    resolve the attachment objects it references.
  const attachments = ctx.get('attachments')
  const attachRoot = attachments !== undefined ? attachmentsRoot(attachments) : undefined
  let attachmentRefs = { images: new Map(), files: new Map() }
  if (known && persistence !== undefined && attachments !== undefined) {
    try {
      const handle = await persistence.open(sessionId, 'read')
      try {
        const { events } = await handle.read(0, undefined)
        attachmentRefs = collectSessionAttachments(events)
      } finally {
        await handle.close()
      }
    } catch (error) {
      warnings.push(`attachment scan failed: ${messageOf(error)}`)
    }
  }

  // 4. Remove the durable artifacts.
  const roots = sessionRoots(persistence)
  const sessionDir = await findSessionDir(roots, cwd, sessionId)
  if (sessionDir === undefined) {
    if (known) warnings.push('session log directory was not found')
  } else if (!isInside(sessionDir, roots)) {
    warnings.push(`refused to remove a path outside the session root: ${sessionDir}`)
  } else {
    try {
      await rm(sessionDir, { recursive: true, force: true })
      removed.push(sessionDir)
    } catch (error) {
      warnings.push(`session log removal failed: ${messageOf(error)}`)
    }
  }

  const cacheFiles = await projectionCacheFiles(sessionId)
  for (const file of cacheFiles) {
    if (!isInside(file, [dshHomePath('storages')])) {
      warnings.push(`refused to remove a path outside the storage root: ${file}`)
      continue
    }
    try {
      await rm(file, { force: true })
      removed.push(file)
    } catch (error) {
      warnings.push(`projection cache removal failed: ${messageOf(error)}`)
    }
  }

  if (attachRoot !== undefined) {
    const paths = attachmentPathsFor(attachmentRefs, attachRoot)
    for (const path of paths) {
      if (!isInside(path, [attachRoot])) {
        warnings.push(`refused to remove an attachment outside its root: ${path}`)
        continue
      }
      try {
        await rm(path, { recursive: true, force: true })
        removed.push(path)
      } catch (error) {
        warnings.push(`attachment removal failed: ${messageOf(error)}`)
      }
    }
  }

  // 5. Drop every reference that could keep the deleted id visible.
  if (registry !== undefined) {
    try {
      for (const workspace of registry.list()) {
        try {
          await workspace.detachSession(sessionId)
        } catch (error) {
          warnings.push(`workspace detach failed: ${messageOf(error)}`)
        }
      }
    } catch (error) {
      warnings.push(`workspace enumeration failed: ${messageOf(error)}`)
    }
    try {
      await registry.unarchiveSession(sessionId)
    } catch {
      /* not archived */
    }
    try {
      await registry.unpinSession(sessionId)
    } catch {
      /* not pinned */
    }
  }

  // 6. Refresh the browser catalog so the row leaves the sidebar list.
  if (typeof ctx.emit === 'function') {
    try {
      ctx.emit('api-session/removed', sessionId)
    } catch (error) {
      warnings.push(`catalog refresh failed: ${messageOf(error)}`)
    }
  }

  const found = known || removed.length > 0
  return {
    ok: found,
    sessionId,
    ...(found ? {} : { error: 'session-not-found' }),
    removed,
    warnings,
    formatVersion: SESSION_FORMAT_VERSION,
  }
}

/**
 * Build one JSON response.
 * @param payload - JSON-serializable body.
 * @param status - HTTP status code.
 * @returns the response.
 */
function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Serve one deletion request from the browser half.
 * @param ctx - the plugin's Cordis context.
 * @param request - the incoming Fetch request.
 * @returns the JSON response.
 */
async function handleDeleteRequest(ctx, request) {
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method-not-allowed' }, 405)

  let payload
  try {
    const text = await request.text()
    payload = text.length === 0 ? {} : JSON.parse(text)
  } catch {
    return jsonResponse({ ok: false, error: 'invalid-json' }, 400)
  }

  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
  if (!isSafeSessionId(sessionId)) return jsonResponse({ ok: false, error: 'invalid-session-id' }, 400)

  try {
    const result = await deleteSession(ctx, sessionId)
    return jsonResponse(result, result.ok ? 200 : 404)
  } catch (error) {
    return jsonResponse({ ok: false, sessionId, error: messageOf(error) }, 500)
  }
}

/**
 * Register the authenticated deletion route.
 * @param ctx - the plugin's Cordis context.
 */
export function apply(ctx) {
  const connection = ctx.get('connection')
  if (connection === undefined) return
  ctx.effect(
    () =>
      connection.fetch.register({
        path: SESSION_DELETE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handleDeleteRequest(ctx, request),
      }),
    ROUTE_LABEL,
  )
}
