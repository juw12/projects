# `@openforge/git-transport`

The Git Smart HTTP transport layer for OpenForge. Every `git clone
https://...` and `git push https://...` to an OpenForge host is
served by this package.

## What it does

Implements the two-phase stateless RPC defined by
[`git-http-backend(1)`](https://git-scm.com/docs/http-protocol):

| Phase | Method | Path                  | What happens                                |
|-------|--------|-----------------------|---------------------------------------------|
| 1     | GET    | `/info/refs`          | Advertise refs + capability list            |
| 2     | POST   | `/git-upload-pack`    | Negotiate and stream a fetch pack           |
| 2     | POST   | `/git-receive-pack`   | Accept a push pack and emit status report   |

`/info/refs` produces a pkt-line stream starting with
`# service=<svc>\n` and ending with `0000`. The POST endpoints
pipe request body → `git <svc> --stateless-rpc` stdin and that git
subprocess's stdout → HTTP response, byte-for-byte.

## Why we shell out to the `git` binary

Every reference implementation does the same:

- **Gitea** — `routers/web/githttp.go` shells out via
  `modules/git/gitcmd/command.go`
- **Forgejo** — same code path, forked from Gitea
- **OneDev** — `server/core/plugin/git/command.go` plus
  `server/jetpack/git-clone`, both spawn `git` as a child process
- **git itself** — even the C implementation is structured this way;
  there is no in-process alternative for `upload-pack`/`receive-pack`

Reimplementing packfile negotiation in TypeScript (shallow, partial
clone, multi-ack, side-band-64k, push-options) is a multi-year project
and the single biggest source of protocol bugs in any Git server.
Shelling out means we inherit decades of battle-tested edge-case
handling for free.

## When to use this package

Always. There is no other way in OpenForge to expose a Git repo over
HTTPS — the route layer in `apps/api/src/routes/git.ts` delegates
every Git HTTP request here.

## Public API

```ts
import {
  getInfoRefs,
  postUploadPack,
  postReceivePack,
  extractAuth,
  writePacketLine,
  writeFlushPacket,
  parsePacketLines,
  DEFAULT_CAPABILITIES_UPLOAD,
  DEFAULT_CAPABILITIES_RECEIVE,
} from '@openforge/git-transport'
```

## Streaming discipline

Packfile negotiation messages from partial-clone clients can be tens
of megabytes; the negotiated pack itself can be hundreds of megabytes.
The handlers NEVER call `await req.arrayBuffer()` and NEVER assemble
git's stdout in JS memory — every byte goes request body → git stdin →
git stdout → HTTP response via Node stream pipes. If a client
disconnects mid-stream, `gitProc.stdout.pipe(res)` raises EPIPE; the
helpers in `process.ts` catch that and SIGTERM the git subprocess
with a 5-second SIGKILL escalation.

## Configuration

| Env var             | Default          | Notes                                      |
|---------------------|------------------|--------------------------------------------|
| `GIT_BINARY_PATH`   | `/usr/bin/git`   | Windows falls back to `git` via PATH       |

## Reference

- Gitea: [`routers/web/githttp.go`](https://github.com/go-gitea/gitea/blob/main/routers/web/githttp.go)
- Gitea git subprocess: [`modules/git/gitcmd/command.go`](https://github.com/go-gitea/gitea/blob/main/modules/git/gitcmd/command.go)
- Git protocol spec: <https://git-scm.com/docs/http-protocol>
- pkt-line format: <https://github.com/git/git/blob/master/Documentation/technical/pack-protocol.txt>
