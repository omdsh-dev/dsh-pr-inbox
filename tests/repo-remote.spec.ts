import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectRepo, preferredRemote } from '../src/host/repo'

/** 建一个真的 git 仓库（remote 只是配置，不需要网络）。 */
function makeRepo(remotes: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'pr-inbox-repo-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  for (const [name, url] of Object.entries(remotes)) {
    execFileSync('git', ['remote', 'add', name, url], { cwd: dir })
  }
  return dir
}

describe('preferredRemote', () => {
  it('prefers upstream over origin (the fork checkout layout)', async () => {
    const dir = makeRepo({
      origin: 'git@github.com:me/project.git',
      upstream: 'https://github.com/org/project.git',
    })
    try {
      expect(await preferredRemote(dir)).toEqual({ name: 'upstream', url: 'https://github.com/org/project.git' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to origin, then to the first named remote', async () => {
    const originOnly = makeRepo({ origin: 'https://github.com/me/project.git' })
    const other = makeRepo({ zeta: 'https://github.com/o/r.git' })
    try {
      expect(await preferredRemote(originOnly)).toEqual({ name: 'origin', url: 'https://github.com/me/project.git' })
      expect(await preferredRemote(other)).toEqual({ name: 'zeta', url: 'https://github.com/o/r.git' })
    } finally {
      rmSync(originOnly, { recursive: true, force: true })
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('returns undefined for a repo without remotes', async () => {
    const dir = makeRepo()
    try {
      expect(await preferredRemote(dir)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('detectRepo', () => {
  it('binds the upstream project and reports which remote it used', async () => {
    const dir = makeRepo({
      origin: 'git@github.com:me/project.git',
      upstream: 'https://github.com/org/project.git',
    })
    try {
      const repo = await detectRepo(dir)
      expect(repo).toMatchObject({
        host: 'github.com',
        owner: 'org',
        name: 'project',
        fullName: 'org/project',
        remoteName: 'upstream',
      })
      expect(repo?.root).not.toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
