import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ghJson: vi.fn(), detectRepo: vi.fn() }))

vi.mock('../src/host/gh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/host/gh')>()
  return { ...actual, ghJson: mocks.ghJson }
})

vi.mock('../src/host/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/host/repo')>()
  return { ...actual, detectRepo: mocks.detectRepo }
})

const {
  capText, detailOp, mergeTimeline, normalizeFile, normalizeIssueComment,
  normalizePull, normalizeReview, requirePullNumber, resetDetailCache,
} = await import('../src/host/detail')

const REPO = {
  host: 'github.com', owner: 'omdsh-dev', name: 'DSH-better-sidebar',
  fullName: 'omdsh-dev/DSH-better-sidebar',
  remoteUrl: 'https://github.com/omdsh-dev/DSH-better-sidebar.git',
  root: '/w/DSH-better-sidebar',
}

const PULL = {
  number: 969,
  title: 'feat(git-graph): 只读提交图',
  body: '## 动机\n\n给 Git 面板加只读提交图。',
  html_url: 'https://github.com/omdsh-dev/DSH-better-sidebar/pull/969',
  user: { login: 'vlln' },
  state: 'open',
  draft: false,
  created_at: '2026-10-16T03:00:00Z',
  updated_at: '2026-10-16T04:00:00Z',
  merged_at: null,
  additions: 2115,
  deletions: 1174,
  changed_files: 3,
  commits: 5,
  comments: 2,
  review_comments: 0,
  mergeable_state: 'clean',
  labels: [{ name: 'feat' }],
  head: { ref: 'feat/git-graph' },
  base: { ref: 'dev' },
}

const FILES = [
  { filename: 'src/git-graph.ts', status: 'added', additions: 133, deletions: 0 },
  { filename: 'src/client/changes/GitGraphLens.tsx', status: 'added', additions: 311, deletions: 0 },
  { filename: 'src/client/changes/OldLens.tsx', status: 'renamed', additions: 4, deletions: 2, previous_filename: 'src/client/changes/Lens.tsx' },
]

const COMMENTS = [
  { user: { login: 'reviewer' }, created_at: '2026-10-16T05:00:00Z', body: '这里的分页边界要不要也钉一下？' },
]

const REVIEWS = [
  { user: { login: 'maintainer' }, state: 'APPROVED', submitted_at: '2026-10-16T06:00:00Z', body: '' },
  { user: { login: 'other' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-10-16T04:30:00Z', body: '请补一条 e2e' },
]

function routeGh(overrides: (url: string) => unknown = () => undefined) {
  mocks.ghJson.mockImplementation(async (args: string[]) => {
    const url = args.find(arg => arg.startsWith('repos/')) ?? ''
    const forced = overrides(url)
    if (forced instanceof Error) throw forced
    if (forced !== undefined) return forced
    if (url.endsWith('/files')) return FILES
    if (url.includes('/issues/')) return COMMENTS
    if (url.endsWith('/reviews')) return REVIEWS
    return PULL
  })
}

beforeEach(() => {
  resetDetailCache()
  mocks.ghJson.mockReset()
  mocks.detectRepo.mockReset().mockResolvedValue(REPO)
})

afterEach(() => {
  resetDetailCache()
})

describe('requirePullNumber', () => {
  it('accepts positive integers', () => {
    expect(requirePullNumber(1)).toBe(1)
    expect(requirePullNumber(969)).toBe(969)
  })

  it('rejects anything else as bad-request', () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2, '969', undefined, null, {}]) {
      expect(() => requirePullNumber(value), String(value)).toThrowError(/合法的 PR 编号/)
    }
  })
})

describe('capText', () => {
  it('passes short text through and reports truncation for long text', () => {
    expect(capText('abc', 10)).toEqual({ text: 'abc', truncated: false })
    expect(capText('abcdef', 3)).toEqual({ text: 'abc', truncated: true })
  })
})

describe('normalizePull', () => {
  it('carries the fields the detail view renders', () => {
    const detail = normalizePull(PULL)
    expect(detail).toMatchObject({
      number: 969,
      title: 'feat(git-graph): 只读提交图',
      author: 'vlln',
      state: 'open',
      isDraft: false,
      baseRef: 'dev',
      headRef: 'feat/git-graph',
      additions: 2115,
      deletions: 1174,
      changedFiles: 3,
      commits: 5,
      comments: 2,
      reviewComments: 0,
      mergeableState: 'clean',
      labels: ['feat'],
      bodyTruncated: false,
    })
    expect(detail?.mergedAt).toBeUndefined()
  })

  it('flags a truncated body instead of silently cutting it', () => {
    const detail = normalizePull({ ...PULL, body: 'x'.repeat(70 * 1024) })
    expect(detail?.bodyTruncated).toBe(true)
    expect(detail?.body.length).toBe(64 * 1024)
  })

  it('keeps merged_at only when present', () => {
    expect(normalizePull({ ...PULL, merged_at: '2026-10-16T07:00:00Z' })?.mergedAt)
      .toBe('2026-10-16T07:00:00Z')
  })

  it('returns undefined when upstream loses the identity fields', () => {
    expect(normalizePull({ ...PULL, number: undefined })).toBeUndefined()
    expect(normalizePull({ ...PULL, title: 7 })).toBeUndefined()
  })
})

describe('normalizeFile / normalizeIssueComment / normalizeReview', () => {
  it('keeps renames addressable by both names', () => {
    expect(normalizeFile(FILES[2]!)).toEqual({
      path: 'src/client/changes/OldLens.tsx',
      status: 'renamed',
      additions: 4,
      deletions: 2,
      previousPath: 'src/client/changes/Lens.tsx',
    })
  })

  it('drops a file row without a filename', () => {
    expect(normalizeFile({ status: 'added' })).toBeUndefined()
  })

  it('marks an over-long comment body inside the text itself', () => {
    const row = normalizeIssueComment({ user: { login: 'a' }, created_at: '2026-10-16T05:00:00Z', body: 'y'.repeat(9 * 1024) })
    expect(row?.body).toContain('已截断')
    expect(row?.body.length).toBeLessThan(8 * 1024 + 40)
  })

  it('requires a review state to keep a review row', () => {
    expect(normalizeReview({ user: { login: 'a' }, submitted_at: '2026-10-16T06:00:00Z', body: '' })?.reviewState).toBeUndefined()
    expect(normalizeReview({ user: { login: 'a' }, state: 'APPROVED', submitted_at: '2026-10-16T06:00:00Z', body: '' }))
      .toMatchObject({ kind: 'review', author: 'a', reviewState: 'APPROVED' })
  })
})

describe('mergeTimeline', () => {
  it('merges comments and reviews chronologically', () => {
    const comments = COMMENTS.map(row => normalizeIssueComment(row)!)
    const reviews = REVIEWS.map(row => normalizeReview(row)!)
    expect(mergeTimeline(comments, reviews).map(row => `${row.kind}:${row.author}`))
      .toEqual(['review:other', 'comment:reviewer', 'review:maintainer'])
  })

  it('keeps unparsable dates from throwing the sort', () => {
    const rows = mergeTimeline(
      [{ kind: 'comment', author: 'a', createdAt: 'nope', body: '' }],
      [{ kind: 'review', author: 'b', createdAt: '2026-10-16T06:00:00Z', body: '' }],
    )
    expect(rows).toHaveLength(2)
  })
})

describe('detailOp', () => {
  it('assembles the whole detail from four bounded reads', async () => {
    routeGh()
    const value = await detailOp({ cwd: '/w/DSH-better-sidebar', number: 969 })
    expect(mocks.ghJson).toHaveBeenCalledTimes(4)
    expect(value.repo.fullName).toBe(REPO.fullName)
    expect(value.files).toHaveLength(3)
    expect(value.filesTruncated).toBe(false)
    expect(value.timeline.map(row => row.kind)).toEqual(['review', 'comment', 'review'])
    expect(value.timelineTruncated).toBe(false)
    expect(value.warnings).toEqual([])
  })

  it('passes the page sizes so the response stays bounded', async () => {
    routeGh()
    await detailOp({ cwd: '/w/repo', number: 969 })
    const calls = mocks.ghJson.mock.calls.map(call => (call[0] as string[]).join(' '))
    expect(calls.find(call => call.includes('/files'))).toContain('per_page=100')
    expect(calls.find(call => call.includes('/comments'))).toContain('per_page=50')
    expect(calls.find(call => call.includes('/reviews'))).toContain('per_page=50')
  })

  // 真实冒烟抓到的 bug：`gh api` 带 `-f` 时**默认发 POST** —— 文件清单 404、
  // 评论 422（POST 建评论缺 body）。凡带 `-f` 的读都必须显式 `-X GET`。
  it('every field-carrying read is an explicit GET', async () => {
    routeGh()
    await detailOp({ cwd: '/w/repo', number: 969 })
    const withFields = mocks.ghJson.mock.calls
      .map(call => call[0] as string[])
      .filter(argv => argv.includes('-f'))
    expect(withFields).toHaveLength(3)
    for (const argv of withFields) {
      expect(argv.slice(0, 3), argv.join(' ')).toEqual(['api', '-X', 'GET'])
    }
  })

  it('flags truncation when the page is shorter than what GitHub counted', async () => {
    routeGh(url => (url.endsWith('/files') ? [FILES[0]!] : undefined))
    const value = await detailOp({ cwd: '/w/repo', number: 969 })
    expect(value.files).toHaveLength(1)
    expect(value.filesTruncated).toBe(true)
  })

  it('degrades per branch: a failing comments read leaves the rest intact', async () => {
    routeGh(url => (url.includes('/issues/') ? new Error('API rate limit exceeded') : undefined))
    const value = await detailOp({ cwd: '/w/repo', number: 969 })
    expect(value.warnings.join(' ')).toContain('rate limit')
    expect(value.files).toHaveLength(3)
    expect(value.timeline.map(row => row.kind)).toEqual(['review', 'review'])
  })

  it('fails loudly when the PR itself cannot be read', async () => {
    const { PrInboxError } = await import('../src/host/gh')
    routeGh(url => (url.endsWith('/969') ? new PrInboxError('HTTP 404: Not Found', 'not-found', 404) : undefined))
    await expect(detailOp({ cwd: '/w/repo', number: 969 })).rejects.toMatchObject({ code: 'not-found' })
  })

  it('caches one PR for 30 s', async () => {
    routeGh()
    await detailOp({ cwd: '/w/repo', number: 969 })
    await detailOp({ cwd: '/w/repo', number: 969 })
    expect(mocks.ghJson).toHaveBeenCalledTimes(4)
  })

  it('rejects a relative cwd, a bad number and a foreign host', async () => {
    await expect(detailOp({ cwd: 'rel', number: 969 })).rejects.toMatchObject({ code: 'bad-request' })
    await expect(detailOp({ cwd: '/w/repo', number: 'x' })).rejects.toMatchObject({ code: 'bad-request' })

    mocks.detectRepo.mockResolvedValue(undefined)
    await expect(detailOp({ cwd: '/w/repo', number: 969 })).rejects.toMatchObject({ code: 'no-repo' })

    mocks.detectRepo.mockResolvedValue({ ...REPO, host: 'gitlab.example.com' })
    await expect(detailOp({ cwd: '/w/repo', number: 969 })).rejects.toMatchObject({ code: 'unsupported-host' })
  })
})