export type GitService = 'upload-pack' | 'receive-pack'

export interface InfoRefsRequest {
  service: GitService
  repoDir: string
  advertiseRefs: boolean
}

export interface PackRequest {
  service: GitService
  repoDir: string
  gitProtocol?: string
  sshOriginalCommand?: string
  body: ReadableStream<Uint8Array> | Buffer
  contentEncoding?: 'gzip' | 'identity'
  env?: Record<string, string>
}

export interface PackResponse {
  contentType: 'application/x-git-upload-pack-result' | 'application/x-git-receive-pack-result'
  body: ReadableStream<Uint8Array>
  status: 200
}

export interface PacketLine {
  kind: 'data' | 'flush' | 'delim' | 'error'
  data?: Buffer
  text?: string
}

export interface AuthInfo {
  type: 'none'
}

export interface BasicAuth {
  type: 'basic'
  username: string
  password: string
}

export interface TokenAuth {
  type: 'token'
  token: string
}

export type ExtractedAuth = AuthInfo | BasicAuth | TokenAuth

export interface TransportRequestLike {
  headers: Headers
  query: URLSearchParams
  ip: string
}

export interface TransportResponse {
  statusCode?: number | undefined
  setHeader: (name: string, value: string | number) => void
  write: (chunk: Buffer | string) => boolean | void
  end: (chunk?: Buffer | string) => void
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  once?: (event: string, listener: (...args: unknown[]) => void) => void
  writable?: boolean
}
