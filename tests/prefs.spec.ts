import { describe, expect, it } from 'vitest'
import { loadDensity, saveDensity } from '../src/client/prefs'
import type { KeyValueStore } from '../src/client/prefs'

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
  }
}

describe('density preference', () => {
  it('defaults to compact and round-trips the two valid values', () => {
    const store = memoryStore()
    expect(loadDensity(store)).toBe('compact')
    saveDensity('detailed', store)
    expect(loadDensity(store)).toBe('detailed')
    saveDensity('compact', store)
    expect(loadDensity(store)).toBe('compact')
  })

  it('falls back to compact when storage throws (private mode / sandbox)', () => {
    const broken: KeyValueStore = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    expect(loadDensity(broken)).toBe('compact')
    expect(() => { saveDensity('detailed', broken) }).not.toThrow()
  })

  it('ignores unknown stored values', () => {
    const store = memoryStore()
    store.setItem('dsh-pr-inbox:density', 'huge')
    expect(loadDensity(store)).toBe('compact')
  })
})
