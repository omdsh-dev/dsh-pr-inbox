/**
 * 对**真实 gh** 的取数冒烟：默认跳过（`PR_INBOX_LIVE=1` 才跑），
 * 因为它要网络 + 本机登录态，不适合进 CI。用途是给 UI 侧一个可信的数据样本，
 * 以及确认三桶的限定词在真 GitHub 上确实是我们要的那三批 PR。
 */
import { describe, expect, it } from 'vitest'
import { detailOp } from '../src/host/detail'
import { listOp } from '../src/host/prs'

const LIVE = process.env.PR_INBOX_LIVE === '1'
// 工作区默认取当前仓库（发布后它自己有 GitHub remote）；要验别的仓库用 PR_INBOX_WORKSPACE。
const WORKSPACE = process.env.PR_INBOX_WORKSPACE ?? process.cwd()

describe.skipIf(!LIVE)('live gh buckets (PR_INBOX_LIVE=1)', () => {
  it('reads the three buckets for the bound workspace', async () => {
    const value = await listOp({ cwd: WORKSPACE })
    console.log('repo:', value.repo?.fullName, '| gh:', value.gh.version, `@${value.gh.login}`)
    for (const [key, bucket] of Object.entries(value.buckets)) {
      console.log(`${key}: total=${bucket.total} rows=${bucket.rows.length}`,
        bucket.error === undefined ? '' : `error=${bucket.error.message}`)
      if (bucket.rows[0] !== undefined) {
        console.log(`   #${bucket.rows[0].number} ${bucket.rows[0].title.slice(0, 60)} @${bucket.rows[0].author}`)
      }
    }
    expect(value.repo?.fullName).toBe('omdsh-dev/DSH-better-sidebar')
    expect(value.gh.available).toBe(true)
    // 三桶都拿到了真数据（本仓当前状态：我提的 2 条、最近合并数百条）。
    expect(value.buckets.authored.rows.map(row => row.number)).toContain(969)
    expect(value.buckets.merged.total).toBeGreaterThan(0)
    expect(value.buckets.merged.rows.length).toBeLessThanOrEqual(20)
    expect(value.buckets.authored.error).toBeUndefined()
    expect(value.buckets.merged.error).toBeUndefined()
  }, 90_000)

  it('reads one real PR detail (body / timeline / files)', async () => {
    const detail = await detailOp({ cwd: WORKSPACE, number: 969 })
    console.log(`detail #${detail.number} ${detail.title}`)
    console.log(`  body ${detail.body.length} chars (truncated=${detail.bodyTruncated}) · ${detail.additions}+ ${detail.deletions}- · ${detail.changedFiles} files · ${detail.commits} commits`)
    console.log(`  base=${detail.baseRef} head=${detail.headRef} state=${detail.state} draft=${detail.isDraft}`)
    console.log(`  files(returned)=${detail.files.length} truncated=${detail.filesTruncated} · timeline=${detail.timeline.length} truncated=${detail.timelineTruncated}`)
    console.log(`  warnings=${JSON.stringify(detail.warnings)}`)
    for (const file of detail.files.slice(0, 5)) console.log(`   ${file.status} ${file.path} +${file.additions} -${file.deletions}`)
    expect(detail.number).toBe(969)
    expect(detail.author).toBe('vlln')
    expect(detail.baseRef).toBe('dev')
    expect(detail.body.length).toBeGreaterThan(0)
    expect(detail.changedFiles).toBeGreaterThan(0)
    expect(detail.files.length).toBeGreaterThan(0)
    expect(detail.filesTruncated).toBe(false)
    expect(detail.warnings).toEqual([])
  }, 90_000)
})