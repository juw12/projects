export const objectKey = {
  packfile(orgSlug: string, repoSlug: string, sha: string) {
    return `repos/${orgSlug}/${repoSlug}/objects/pack/${sha}.pack`
  },
  idx(orgSlug: string, repoSlug: string, sha: string) {
    return `repos/${orgSlug}/${repoSlug}/objects/pack/${sha}.idx`
  },
  midx(orgSlug: string, repoSlug: string) {
    return `repos/${orgSlug}/${repoSlug}/objects/pack/multi-pack-index`
  },
  lfs(orgSlug: string, repoSlug: string, oid: string) {
    return `lfs/${orgSlug}/${repoSlug}/${oid}`
  },
  webhookPayload(deliveryId: string) {
    return `webhook-payloads/${deliveryId}.json`
  },
  jobLog(runId: string, jobId: string, chunkSeq: number) {
    return `job-logs/${runId}/${jobId}/${String(chunkSeq).padStart(8, '0')}.log`
  },
}
