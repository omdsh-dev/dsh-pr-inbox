import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'

const mocks = vi.hoisted(() => ({
  ghJson: vi.fn(),
  runGhBuffer: vi.fn(),
  detectRepo: vi.fn(),
}))

vi.mock('../src/host/gh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/host/gh')>()
  return { ...actual, ghJson: mocks.ghJson, runGhBuffer: mocks.runGhBuffer }
})

vi.mock('../src/host/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/host/repo')>()
  return { ...actual, detectRepo: mocks.detectRepo }
})

const {
  IMAGE_PATH, imageHandler, imageMimeFor, requireRef, requireRepoPath, resetImageCache, resolveImage, sniffImageMime,
} = await import('../src/host/image')
const { PrInboxError } = await import('../src/host/gh')

/** 一张真的 1×1 PNG（67 字节）——魔数校验必须拿真字节验，不能用编的。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>', 'utf8')

const REPO = {
  host: 'github.com', owner: 'omdsh-dev', name: 'DSH-better-sidebar',
  fullName: 'omdsh-dev/DSH-better-sidebar',
  remoteUrl: 'https://github.com/omdsh-dev/DSH-better-sidebar.git',
  root: '/w/DSH-better-sidebar',
}
const CWD = '/w/DSH-better-sidebar'

beforeEach(() => {
  resetImageCache()
  mocks.ghJson.mockReset()
  mocks.runGhBuffer.mockReset()
  mocks.detectRepo.mockReset()
  mocks.detectRepo.mockResolvedValue(REPO)
  mocks.ghJson.mockResolvedValue({ size: PNG.length })
  mocks.runGhBuffer.mockResolvedValue(PNG)
})

afterEach(() => { resetImageCache() })

describe('词法闸门', () => {
  it('accepts repo-relative image paths and rejects everything else', () => {
    for (const good of ['icon.svg', 'docs/img/a b.png', 'a/b/c.webp', '.github/logo.png']) {
      expect(requireRepoPath(good), good).toBe(good)
    }
    for (const bad of ['', '/abs.png', 'a/../b.png', '..', 'a//b.png', 'a/./b.png', 'x'.repeat(513), null, 42, undefined]) {
      expect(() => requireRepoPath(bad), String(bad)).toThrow(PrInboxError)
    }
    expect(() => requireRepoPath('a/../b.png')).toThrowError(/`\.\.`/)
  })

  it('accepts branches, tags, shas and pull refs, and rejects junk', () => {
    for (const good of ['dev', 'feat/git-graph', 'refs/pull/969/head', 'v0.26.1', 'a'.repeat(40)]) {
      expect(requireRef(good), good).toBe(good)
    }
    for (const bad of ['', '-x', '--all', 'a b', 'a\nb', 'a'.repeat(257), null, 7]) {
      expect(() => requireRef(bad), String(bad)).toThrow(PrInboxError)
    }
  })
})

describe('MIME 与魔数', () => {
  it('maps only known image extensions', () => {
    expect(imageMimeFor('icon.svg')).toBe('image/svg+xml')
    expect(imageMimeFor('A.PNG')).toBe('image/png')
    expect(imageMimeFor('photo.jpeg')).toBe('image/jpeg')
    expect(imageMimeFor('notes.txt')).toBeUndefined()
    expect(imageMimeFor('LICENSE')).toBeUndefined()
  })

  it('confirms the bytes really look like the claimed image type', () => {
    expect(sniffImageMime(PNG, 'image/png')).toBe(true)
    expect(sniffImageMime(PNG, 'image/jpeg')).toBe(false)
    expect(sniffImageMime(Buffer.from('not an image'), 'image/png')).toBe(false)
    expect(sniffImageMime(SVG, 'image/svg+xml')).toBe(true)
    expect(sniffImageMime(Buffer.from('\uFEFF  <?xml version="1.0"?><svg/>'), 'image/svg+xml')).toBe(true)
    expect(sniffImageMime(Buffer.from('<html></html>'), 'image/svg+xml')).toBe(false)
    // 已知前缀但长度不足（截断的魔数）也算不符。
    expect(sniffImageMime(Buffer.from([0x89, 0x50]), 'image/png')).toBe(false)
  })
})

describe('resolveImage', () => {
  it('asks for the size first, then reads raw bytes with an explicit GET', async () => {
    const value = await resolveImage(CWD, 'dev', 'icon.png')
    expect(value.mime).toBe('image/png')
    expect(value.bytes.equals(PNG)).toBe(true)
    expect(value.fullName).toBe(REPO.fullName)
    expect(value.cached).toBe(false)
    expect(mocks.ghJson).toHaveBeenCalledWith([
      'api', '-X', 'GET', 'repos/omdsh-dev/DSH-better-sidebar/contents/icon.png',
      '-f', 'ref=dev', '-H', 'Accept: application/vnd.github+json',
    ])
    const argv = mocks.runGhBuffer.mock.calls[0]![0] as string[]
    expect(argv.slice(0, 3)).toEqual(['api', '-X', 'GET'])
    expect(argv).toContain('repos/omdsh-dev/DSH-better-sidebar/contents/icon.png')
    expect(argv).toContain('ref=dev')
    expect(argv).toContain('Accept: application/vnd.github.raw')
    // maxBuffer 是那条硬上限（8 MiB + 余量）。
    expect(mocks.runGhBuffer.mock.calls[0]![1]).toBe(8 * 1024 * 1024 + 64 * 1024)
  })

  it('serves an SVG whose bytes really are SVG', async () => {
    mocks.runGhBuffer.mockResolvedValue(SVG)
    const value = await resolveImage(CWD, 'dev', 'icon.svg')
    expect(value.mime).toBe('image/svg+xml')
    expect(value.bytes.equals(SVG)).toBe(true)
  })

  it('refuses a non-image extension without touching gh', async () => {
    await expect(resolveImage(CWD, 'dev', 'notes.txt')).rejects.toMatchObject({ code: 'unsupported-type', status: 415 })
    expect(mocks.ghJson).not.toHaveBeenCalled()
    expect(mocks.runGhBuffer).not.toHaveBeenCalled()
  })

  it('refuses bytes whose magic does not match the extension', async () => {
    mocks.runGhBuffer.mockResolvedValue(Buffer.from('<html>not a png</html>'))
    await expect(resolveImage(CWD, 'dev', 'icon.png')).rejects.toMatchObject({ code: 'unsupported-type', status: 415 })
  })

  it('rejects an oversized image from the size field without downloading it', async () => {
    mocks.ghJson.mockResolvedValue({ size: 9 * 1024 * 1024 })
    await expect(resolveImage(CWD, 'dev', 'big.png')).rejects.toMatchObject({ code: 'too-large', status: 413 })
    expect(mocks.runGhBuffer).not.toHaveBeenCalled()
  })

  it('maps a maxBuffer overflow to 413 as well (second gate)', async () => {
    mocks.runGhBuffer.mockRejectedValue(new PrInboxError('文件超过本插件允许的大小', 'too-large', 413))
    await expect(resolveImage(CWD, 'dev', 'icon.png')).rejects.toMatchObject({ status: 413 })
  })

  it('maps a missing project / non-github host to 404 / 501', async () => {
    mocks.detectRepo.mockResolvedValue(undefined)
    await expect(resolveImage(CWD, 'dev', 'icon.png')).rejects.toMatchObject({ code: 'no-repo', status: 404 })
    mocks.detectRepo.mockResolvedValue({ ...REPO, host: 'gitlab.example.com' })
    await expect(resolveImage(CWD, 'dev', 'icon.png')).rejects.toMatchObject({ code: 'unsupported-host', status: 501 })
  })

  it('validates cwd / ref / path before any gh call', async () => {
    await expect(resolveImage('relative', 'dev', 'icon.png')).rejects.toMatchObject({ code: 'bad-request', status: 400 })
    await expect(resolveImage(CWD, '', 'icon.png')).rejects.toMatchObject({ code: 'bad-request', status: 400 })
    await expect(resolveImage(CWD, 'dev', 'a/../b.png')).rejects.toMatchObject({ code: 'bad-request', status: 400 })
    expect(mocks.ghJson).not.toHaveBeenCalled()
  })

  it('serves the second request from the bounded cache', async () => {
    await resolveImage(CWD, 'dev', 'icon.png')
    const again = await resolveImage(CWD, 'dev', 'icon.png')
    expect(again.cached).toBe(true)
    expect(mocks.ghJson).toHaveBeenCalledTimes(1)
    expect(mocks.runGhBuffer).toHaveBeenCalledTimes(1)
    // 不同 ref / 路径各自成键。
    mocks.ghJson.mockResolvedValue({ size: PNG.length })
    await resolveImage(CWD, 'main', 'icon.png')
    expect(mocks.ghJson).toHaveBeenCalledTimes(2)
  })

  it('never caches a failure', async () => {
    mocks.ghJson.mockRejectedValueOnce(new PrInboxError('HTTP 404', 'not-found', 404))
    await expect(resolveImage(CWD, 'dev', 'icon.png')).rejects.toMatchObject({ status: 404 })
    await expect(resolveImage(CWD, 'dev', 'icon.png')).resolves.toMatchObject({ cached: false })
    expect(mocks.ghJson).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent requests for the same image', async () => {
    const [first, second] = await Promise.all([
      resolveImage(CWD, 'dev', 'icon.png'),
      resolveImage(CWD, 'dev', 'icon.png'),
    ])
    expect(first.bytes.equals(PNG)).toBe(true)
    expect(second.bytes.equals(PNG)).toBe(true)
    expect(mocks.ghJson).toHaveBeenCalledTimes(1)
  })
})

describe('imageHandler', () => {
  const call = async (method: string, url: string) => {
    const out = { status: 0, headers: {} as Record<string, string>, body: undefined as unknown }
    const res = {
      writeHead(status: number, headers: Record<string, string>) { out.status = status; out.headers = headers; return res },
      end(chunk?: unknown) { out.body = chunk },
    }
    const req = { method, url } as unknown as IncomingMessage
    await imageHandler(req, res as unknown as ServerResponse)
    return out
  }

  it('returns the bytes with image headers on success', async () => {
    const query = new URLSearchParams({ cwd: CWD, ref: 'dev', path: 'icon.png' })
    const out = await call('GET', `${IMAGE_PATH}?${query}`)
    expect(out.status).toBe(200)
    expect(out.headers['content-type']).toBe('image/png')
    expect(out.headers['content-length']).toBe(String(PNG.length))
    expect(out.headers['cache-control']).toBe('private, max-age=300')
    expect(out.headers['x-content-type-options']).toBe('nosniff')
    expect((out.body as Buffer).equals(PNG)).toBe(true)
  })

  it('answers a bad path with the shared JSON envelope and 400', async () => {
    const query = new URLSearchParams({ cwd: CWD, ref: 'dev', path: '../secret.png' })
    const out = await call('GET', `${IMAGE_PATH}?${query}`)
    expect(out.status).toBe(400)
    expect(JSON.parse(String(out.body))).toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('refuses anything but GET / HEAD', async () => {
    const out = await call('POST', IMAGE_PATH)
    expect(out.status).toBe(405)
    expect(mocks.ghJson).not.toHaveBeenCalled()
  })
})