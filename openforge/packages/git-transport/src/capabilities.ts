/**
 * Default capability lists advertised in the first ref advertisement of
 * each service. Clients use these to negotiate which protocol features
 * the server actually supports before issuing wants/haves.
 *
 * Why we advertise each one:
 *
 *   report-status     receive-pack — report per-ref push success/failure.
 *   side-band-64k     both — multiplex progress + error + data over a
 *                    single stream so the client UI can show pack
 *                    generation progress without a side channel.
 *   ofs-delta         both — packfile index uses offsets instead of
 *                    SHA-1 lookups; faster to apply on the client.
 *   push-options      receive-pack — `git push -o <key>=<value>` flows
 *                    through to pre-receive hooks.
 *   no-done           upload-pack — server may send final ACK + pack +
 *                    flush in one round-trip without waiting for an
 *                    explicit `done` from the client.
 *   include-tag       off by default — include the annotated tag object
 *                    alongside the peeled commit when the client wants
 *                    a tag. Off until the client opts in.
 *   multi-ack /       upload-pack — server emits ACKs for each common
 *   multi-ack-detailed  ancestor instead of waiting for a single multi-ack
 *                    boundary; reduces round-trips on deep histories.
 */
export const DEFAULT_CAPABILITIES_UPLOAD: readonly string[] = [
  'multi_ack',
  'multi_ack_detailed',
  'no-done',
  'side-band-64k',
  'ofs-delta',
  'include-tag',
]

export const DEFAULT_CAPABILITIES_RECEIVE: readonly string[] = [
  'report-status',
  'side-band-64k',
  'ofs-delta',
  'push-options',
]

export function defaultCapabilitiesFor(service: 'upload-pack' | 'receive-pack'): readonly string[] {
  return service === 'upload-pack'
    ? DEFAULT_CAPABILITIES_UPLOAD
    : DEFAULT_CAPABILITIES_RECEIVE
}
