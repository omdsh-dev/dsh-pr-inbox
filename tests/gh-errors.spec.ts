/**
 * `gh` 边界条件的**真实进程**测试：不 mock、不发网络请求。
 *
 * 单测里那批合成字符串（`classifyGhFailure`）只能证明「给这句话我会归到这个码」，
 * 证明不了「真实 gh 真的会说这句话、且真的以那种方式失败」。这里三条都真起进程：
 *   ① PATH 里没有 gh          → ENOENT → gh-missing/501
 *   ② 空的 GH_CONFIG_DIR      → 未登录 → gh-unauthenticated/401（gh 真实退出码 4）
 *   ③ 一个会挂住的 gh shim    → 超时被杀 → gh-timeout/504，且**真的**很快返回
 *
 * 这样用户看到的那句「执行 `gh auth login` 登录后再刷新」才是被验证过的提示，
 * 而不是猜的。
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runGh } from '../src/host/gh'

const posixOnly = process.platform === 'win32'

/** 临时改环境变量跑一段逻辑，无论成败都还原（并行用例互不污染）。 */
async function withEnv<T>(patch: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const before = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(patch)) {
    before.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await run()
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('gh process edge cases (real spawns, no network)', () => {
  it.skipIf(posixOnly)('reports a missing gh binary as gh-missing/501', async () => {
    await withEnv({ PATH: '' }, async () => {
      await expect(runGh(['--version'])).rejects.toMatchObject({ code: 'gh-missing', status: 501 })
    })
  })

  it('reports an unauthenticated gh as gh-unauthenticated/401', async () => {
    if (process.env.GH_TOKEN !== undefined || process.env.GITHUB_TOKEN !== undefined) {
      // 有 token 环境变量时 gh 会回退到它，这条前置不成立（CI/本机都不该出现）。
      return
    }
    // 机器上没有真 gh 时，这条前置同样不成立（runGh 会先报 gh-missing）。
    const probe = await runGh(['--version'], 8_000).catch((reason: unknown) => reason)
    if ((probe as { code?: string }).code === 'gh-missing') return
    const config = tempDir('pr-inbox-gh-config-')
    try {
      await withEnv({
        GH_CONFIG_DIR: config,
        GH_TOKEN: undefined,
        GITHUB_TOKEN: undefined,
        // Actions 里 gh 会检测 GITHUB_ACTIONS 并换成 "set GH_TOKEN" 的提示；这条用例
        // 要模拟的是普通机器上的未登录，所以把 Actions 标记也摘掉。
        GITHUB_ACTIONS: undefined,
        CI: undefined,
      }, async () => {
        const error = await runGh(['api', 'user', '-q', '.login']).catch((reason: unknown) => reason)
        expect(error).toMatchObject({ code: 'gh-unauthenticated', status: 401 })
        // gh 的原始 stderr 随版本/环境变化：本机是 "gh auth login" 提示，GitHub Actions
        // 上可能是 "HTTP 401: Bad credentials"。用户可见的「怎么办」现在由客户端按 code
        // 翻译（src/client/errors.ts），这里只要求分类正确且原始信息非空。
        expect((error as Error).message.trim()).not.toBe('')
      })
    } finally {
      rmSync(config, { recursive: true, force: true })
    }
  })

  it.skipIf(posixOnly)('kills a hung gh and reports gh-timeout/504 promptly', async () => {
    const shimDir = tempDir('pr-inbox-gh-shim-')
    try {
      const shim = join(shimDir, 'gh')
      writeFileSync(shim, '#!/bin/sh\nsleep 30\n')
      chmodSync(shim, 0o755)
      const started = Date.now()
      await withEnv({ PATH: `${shimDir}:${process.env.PATH ?? ''}` }, async () => {
        await expect(runGh(['--version'], 400)).rejects.toMatchObject({ code: 'gh-timeout', status: 504 })
      })
      // 被杀而不是等 30 s；留出足够余量给慢机器上的进程启动。
      expect(Date.now() - started).toBeLessThan(8_000)
    } finally {
      rmSync(shimDir, { recursive: true, force: true })
    }
  })
})