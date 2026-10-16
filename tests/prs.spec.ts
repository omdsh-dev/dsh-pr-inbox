import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ghJson: vi.fn(),
  probeGh: vi.fn(),
  detectRepo: vi.fn(),
}))

vi.mock('../src/host/gh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/host/gh')>()
  return { ...actual, ghJson: mocks.ghJson, probeGh: mocks.probeGh }
})

vi.mock('../src/host/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/host/repo')>()
  return { ...actual, detectRepo: mocks.detectRepo }
})

const { bucketQueries, listOp, normalizeSearchItem, resetPrCache } = await import('../src/host/prs')

const REPO = {
  host: 'github.com', owner: 'omdsh-dev', name: 'DSH-better-sidebar',
  fullName: 'omdsh-dev/DSH-better-sidebar',
  remoteUrl: 'https://github.com/omdsh-dev/DSH-better-sidebar.git',
  root: '/w/DSH-better-sidebar',
}

/** 一条真实的 search/issues 行（形状照 GitHub 输出裁到用到的字段）。 */
function item(overrides: Record<string, unknown> = {}) {
  return {
    number: 969,
    title: 'feat(git-graph): 只读提交图',
    html_url: 'https://github.com/omdsh-dev/DSH-better-sidebar/pull/969',
    user: { login: 'vlln' },
    draft: false,
    state: 'open',
    created_at: '2026-10-16T03:00:00Z',
    updated_at: '2026-10-16T04:00:00Z',
    labels: [{ name: 'feat' }, { name: 'sidebar' }],
    comments: 3,
    pull_request: { merged_at: null },
    ...overrides,
  }
}

/** 让 ghJson 按 q 里的限定词回不同的桶，并记录调用。 */
function routeGhJson(perBucket?: (q: string) => unknown) {
  mocks.ghJson.mockImplementation(async (args: string[]) => {
    const q = args.find(arg => arg.startsWith('q=')) ?? ''
    if (perBucket !== undefined) {
      const forced = perBucket(q)
      if (forced instanceof Error) throw forced
      if (forced !== undefined) return forced
    }
    return { total_count: 1, items: [item()] }
  })
}

beforeEach(() => {
  resetPrCache()
  mocks.ghJson.mockReset()
  mocks.probeGh.mockReset().mockResolvedValue({ available: true, version: 'gh version 2.96.0', login: 'vlln' })
  mocks.detectRepo.mockReset().mockResolvedValue(REPO)
})

afterEach(() => {
  resetPrCache()
})

describe('bucketQueries', () => {
  it('expresses the three buckets as search qualifiers on one repository', () => {
    const buckets = bucketQueries(REPO.fullName)
    expect(buckets.map(bucket => bucket.key)).toEqual(['authored', 'review', 'merged'])
    expect(buckets[0]!.q).toBe('repo:omdsh-dev/DSH-better-sidebar is:pr is:open author:@me')
    expect(buckets[1]!.q).toBe('repo:omdsh-dev/DSH-better-sidebar is:pr is:open review-requested:@me')
    expect(buckets[2]!.q).toBe('repo:omdsh-dev/DSH-better-sidebar is:pr is:merged')
  })

  it('caps the merged bucket at the agreed 20 rows', () => {
    expect(bucketQueries(REPO.fullName)[2]!.limit).toBe(20)
  })
})

describe('normalizeSearchItem', () => {
  it('keeps the fields the two densities need', () => {
    expect(normalizeSearchItem(item())).toEqual({
      number: 969,
      title: 'feat(git-graph): 只读提交图',
      url: 'https://github.com/omdsh-dev/DSH-better-sidebar/pull/969',
      author: 'vlln',
      isDraft: false,
      state: 'open',
      createdAt: '2026-10-16T03:00:00Z',
      updatedAt: '2026-10-16T04:00:00Z',
      labels: ['feat', 'sidebar'],
      comments: 3,
    })
  })

  it('carries mergedAt only when the PR really has one', () => {
    expect(normalizeSearchItem(item({ pull_request: { merged_at: '2026-10-16T05:00:00Z' } }))?.mergedAt)
      .toBe('2026-10-16T05:00:00Z')
    expect(normalizeSearchItem(item())?.mergedAt).toBeUndefined()
  })

  it('carries the author avatar when GitHub gives one, and omits the key otherwise', () => {
    const avatar = 'https://avatars.githubusercontent.com/u/1?v=4'
    expect(normalizeSearchItem(item({ user: { login: 'vlln', avatar_url: avatar } }))?.authorAvatar).toBe(avatar)
    // 上面那条 toEqual 已经钉住「没有 avatar_url 时不产出该键」；这里再钉空串与缺字段两条。
    expect(normalizeSearchItem(item())?.authorAvatar).toBeUndefined()
    expect(normalizeSearchItem(item({ user: { login: 'vlln', avatar_url: '' } }))?.authorAvatar).toBeUndefined()
  })

  it('tolerates missing labels / user / counters instead of inventing values', () => {
    const row = normalizeSearchItem(item({ labels: undefined, user: undefined, comments: undefined, draft: undefined }))
    expect(row).toMatchObject({ labels: [], author: '', comments: 0, isDraft: false })
  })

  it('drops rows that lack identity fields (upstream shape drift must not produce half rows)', () => {
    expect(normalizeSearchItem(item({ number: undefined }))).toBeUndefined()
    expect(normalizeSearchItem(item({ title: 42 }))).toBeUndefined()
    expect(normalizeSearchItem(item({ html_url: null }))).toBeUndefined()
  })
})

describe('listOp', () => {
  it('fetches the three buckets in one pass and reports totals', async () => {
    routeGhJson()
    const value = await listOp({ cwd: '/w/DSH-better-sidebar' })
    expect(mocks.ghJson).toHaveBeenCalledTimes(3)
    expect(value.repo?.fullName).toBe(REPO.fullName)
    expect(value.buckets.authored.rows).toHaveLength(1)
    expect(value.buckets.authored.total).toBe(1)
    expect(value.buckets.review.error).toBeUndefined()
    expect(value.note).toBeUndefined()
  })

  it('asks the search API for updated-desc and passes the per-bucket page size', async () => {
    routeGhJson()
    await listOp({ cwd: '/w/repo' })
    const mergedCall = mocks.ghJson.mock.calls.find(call => (call[0] as string[]).some(arg => arg.includes('is:merged')))
    expect(mergedCall?.[0]).toContain('per_page=20')
    expect(mergedCall?.[0]).toContain('sort=updated')
    expect(mergedCall?.[0]).toContain('order=desc')
  })

  it('degrades per bucket: one failing query never blanks the other two', async () => {
    routeGhJson(q => (q.includes('review-requested') ? new Error('API rate limit exceeded') : undefined))
    const value = await listOp({ cwd: '/w/repo' })
    expect(value.buckets.review.rows).toEqual([])
    expect(value.buckets.review.error?.message).toContain('rate limit')
    expect(value.buckets.authored.rows).toHaveLength(1)
    expect(value.buckets.merged.rows).toHaveLength(1)
  })

  it('caches each bucket for the TTL so a tab switch costs nothing', async () => {
    routeGhJson()
    await listOp({ cwd: '/w/repo' })
    await listOp({ cwd: '/w/repo' })
    expect(mocks.ghJson).toHaveBeenCalledTimes(3)
  })

  // ── 契约：UI 直接吃 ListValue，下面四条钉住它的字段语义 ──────────────────────
  it('contract: `total` is the search hit count, `rows` only the current page', async () => {
    const page = Array.from({ length: 20 }, (_, index) => item({ number: 1000 + index }))
    routeGhJson(q => (q.includes('is:merged') ? { total_count: 276, items: page } : undefined))
    const value = await listOp({ cwd: '/w/repo' })
    expect(value.buckets.merged.total).toBe(276)
    expect(value.buckets.merged.rows).toHaveLength(20)
    expect(value.buckets.merged.rows[0]?.number).toBe(1000)
  })

  it('contract: all three bucket keys always exist, in every branch', async () => {
    routeGhJson()
    const normal = await listOp({ cwd: '/w/repo' })
    expect(Object.keys(normal.buckets).sort()).toEqual(['authored', 'merged', 'review'])

    mocks.detectRepo.mockResolvedValue(undefined)
    resetPrCache()
    const noRepo = await listOp({ cwd: '/w/plain' })
    expect(Object.keys(noRepo.buckets).sort()).toEqual(['authored', 'merged', 'review'])
    expect(noRepo.repo).toBeNull()

    mocks.detectRepo.mockResolvedValue({ ...REPO, host: 'gitlab.example.com', fullName: 'g/p' })
    const otherHost = await listOp({ cwd: '/w/repo' })
    expect(Object.keys(otherHost.buckets).sort()).toEqual(['authored', 'merged', 'review'])
  })

  it('contract: a bucket error is per-bucket data, never a thrown list', async () => {
    routeGhJson(q => (q.includes('author:@me') ? new Error('gh 命令超时') : undefined))
    const value = await listOp({ cwd: '/w/repo' })
    expect(value.buckets.authored.error?.message).toContain('超时')
    expect(value.buckets.authored.total).toBe(0)
    expect(value.buckets.authored.rows).toEqual([])
    expect(value.buckets.review.rows).toHaveLength(1)
    expect(value.buckets.merged.rows).toHaveLength(1)
  })

  it('never caches a failure', async () => {
    routeGhJson(q => (q.includes('author:@me') ? new Error('boom') : undefined))
    await listOp({ cwd: '/w/repo' })
    await listOp({ cwd: '/w/repo' })
    // 失败那条重试了；成功的两条走缓存。合计 = 3 + 1。
    expect(mocks.ghJson).toHaveBeenCalledTimes(4)
  })

  // ── 缓存的两条语义：跨会话共享（单例）与上界淘汰（有界）──────────────────────
  it('shares one cache across callers: the key is the repository, not the cwd', async () => {
    routeGhJson()
    await listOp({ cwd: '/w/session-a/repo' })
    await listOp({ cwd: '/w/session-b/checkout' })
    // 两个 cwd → 同一个 owner/repo：第二次一条查询都不该再发。
    expect(mocks.ghJson).toHaveBeenCalledTimes(3)
  })

  it('evicts the oldest entries once the table is full (bounded cache)', async () => {
    routeGhJson()
    const repos = Array.from({ length: 5 }, (_, index) => ({
      ...REPO, owner: `owner${index}`, name: 'repo', fullName: `owner${index}/repo`,
    }))
    for (const repo of repos) {
      mocks.detectRepo.mockResolvedValue(repo)
      await listOp({ cwd: `/w/${repo.owner}` })
    }
    // 5 仓库 × 3 桶 = 15 条 > CACHE_MAX(12)：最旧的 3 条（第一个仓库）已被淘汰。
    expect(mocks.ghJson).toHaveBeenCalledTimes(15)

    mocks.detectRepo.mockResolvedValue(repos[0]!)
    await listOp({ cwd: '/w/owner0' })
    expect(mocks.ghJson).toHaveBeenCalledTimes(18)

    // 最近用过的那个仍在缓存里：不再多发查询。
    mocks.detectRepo.mockResolvedValue(repos[4]!)
    await listOp({ cwd: '/w/owner4' })
    expect(mocks.ghJson).toHaveBeenCalledTimes(18)
  })

  it('does not query anything for a workspace without a forge remote', async () => {
    mocks.detectRepo.mockResolvedValue(undefined)
    const value = await listOp({ cwd: '/w/plain' })
    expect(mocks.ghJson).not.toHaveBeenCalled()
    expect(value.repo).toBeNull()
    expect(value.buckets.authored.rows).toEqual([])
  })

  it('says so instead of guessing on a non-github host', async () => {
    mocks.detectRepo.mockResolvedValue({ ...REPO, host: 'gitlab.example.com', fullName: 'g/p' })
    const value = await listOp({ cwd: '/w/repo' })
    expect(mocks.ghJson).not.toHaveBeenCalled()
    expect(value.note).toContain('github.com')
    expect(value.repo?.host).toBe('gitlab.example.com')
  })

  it('rejects a relative cwd as bad-request', async () => {
    await expect(listOp({ cwd: 'relative' })).rejects.toMatchObject({ code: 'bad-request' })
  })
})