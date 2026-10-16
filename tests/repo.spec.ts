import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRemoteUrl, requireAbsoluteCwd } from '../src/host/repo'
import { PrInboxError } from '../src/host/gh'

/** 跨平台的绝对路径样例：不写任何本机路径（发布卫生门禁会拒）。 */
const ABS_PATH = path.resolve('/tmp/project')

describe('parseRemoteUrl', () => {
  it('parses the https form with and without the .git suffix', () => {
    expect(parseRemoteUrl('https://github.com/omdsh-dev/DSH-better-sidebar.git'))
      .toEqual({ host: 'github.com', owner: 'omdsh-dev', name: 'DSH-better-sidebar' })
    expect(parseRemoteUrl('https://github.com/omdsh-dev/DSH-better-sidebar'))
      .toEqual({ host: 'github.com', owner: 'omdsh-dev', name: 'DSH-better-sidebar' })
    expect(parseRemoteUrl('https://github.com/omdsh-dev/DSH-better-sidebar/'))
      .toEqual({ host: 'github.com', owner: 'omdsh-dev', name: 'DSH-better-sidebar' })
  })

  it('parses the scp form git uses for ssh remotes', () => {
    expect(parseRemoteUrl('git@github.com:vlln/DSH-better-sidebar.git'))
      .toEqual({ host: 'github.com', owner: 'vlln', name: 'DSH-better-sidebar' })
    expect(parseRemoteUrl('github.com:vlln/DSH-better-sidebar'))
      .toEqual({ host: 'github.com', owner: 'vlln', name: 'DSH-better-sidebar' })
  })

  it('parses the ssh:// form', () => {
    expect(parseRemoteUrl('ssh://git@github.com/vlln/DSH-better-sidebar.git'))
      .toEqual({ host: 'github.com', owner: 'vlln', name: 'DSH-better-sidebar' })
    expect(parseRemoteUrl('ssh://git@github.example.com:2222/team/repo.git'))
      .toEqual({ host: 'github.example.com', owner: 'team', name: 'repo' })
  })

  it('never leaks credentials into the identity', () => {
    expect(parseRemoteUrl('https://user:ghp_secret@github.com/vlln/repo.git'))
      .toEqual({ host: 'github.com', owner: 'vlln', name: 'repo' })
  })

  it('keeps a nested owner (self-hosted forges with subgroups)', () => {
    expect(parseRemoteUrl('https://gitlab.example.com/group/sub/project.git'))
      .toEqual({ host: 'gitlab.example.com', owner: 'group/sub', name: 'project' })
  })

  it('returns undefined for things that are not forge coordinates', () => {
    for (const raw of ['', '   ', ABS_PATH, 'github.com', 'https://github.com/only-owner', 'not a url']) {
      expect(parseRemoteUrl(raw), raw).toBeUndefined()
    }
  })
})

describe('requireAbsoluteCwd', () => {
  it('accepts an absolute path and passes it through', () => {
    expect(requireAbsoluteCwd(ABS_PATH)).toBe(ABS_PATH)
  })

  it('rejects relative paths, empty strings and non-strings as bad-request', () => {
    for (const value of ['relative/path', '', undefined, null, 42, {}]) {
      expect(() => requireAbsoluteCwd(value)).toThrow(PrInboxError)
      try {
        requireAbsoluteCwd(value)
      } catch (error) {
        expect((error as PrInboxError).code).toBe('bad-request')
        expect((error as PrInboxError).status).toBe(400)
      }
    }
  })
})