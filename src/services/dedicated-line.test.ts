import { describe, expect, it } from 'vitest'

import type { ProxyGroupView, ProxyViewV1 } from '@/types/proxy-view'

import {
  detectDedicatedLineEntry,
  mergeDedicatedLineApplications,
} from './dedicated-line'

const group = (name: string, now: string, type = 'Selector') =>
  ({ name, now, type }) as ProxyGroupView

const view = (groups: ProxyGroupView[], global = group('GLOBAL', 'manual')) =>
  ({ groups, global }) as ProxyViewV1

describe('dedicated line entry selection', () => {
  it('resolves nested groups to a node so selecting the exit cannot create a dialer loop', () => {
    const proxies = view([
      group('manual', 'auto'),
      group('auto', 'entry', 'URLTest'),
    ])
    expect(detectDedicatedLineEntry(proxies, 'rule', '')).toEqual({
      group: 'manual',
      entry: 'entry',
    })
    expect(detectDedicatedLineEntry(proxies, 'global', '')).toEqual({
      group: 'GLOBAL',
      entry: 'entry',
    })
  })

  it('uses the selected rule group and rejects cycles and direct mode', () => {
    const proxies = view([group('one', 'first'), group('two', 'second')])
    expect(detectDedicatedLineEntry(proxies, 'rule', 'two')).toEqual({
      group: 'two',
      entry: 'second',
    })
    expect(detectDedicatedLineEntry(proxies, 'direct', '')).toBeNull()
    expect(
      detectDedicatedLineEntry(
        view([group('manual', 'auto'), group('auto', 'manual')]),
        'rule',
        '',
      ),
    ).toBeNull()
  })

  it('deduplicates Windows executable paths without merging different Java installations', () => {
    const current = [{ name: 'Bookmap', path: 'C:\\Bookmap\\javaw.exe' }]
    const additions = [
      { name: 'javaw.exe', path: 'c:\\bookmap\\javaw.exe' },
      { name: 'Other Java app', path: 'C:\\Other\\javaw.exe' },
    ]
    expect(
      mergeDedicatedLineApplications(current, additions, true),
    ).toHaveLength(2)
    expect(
      mergeDedicatedLineApplications(current, additions, false),
    ).toHaveLength(3)
    expect(current).toEqual([
      { name: 'Bookmap', path: 'C:\\Bookmap\\javaw.exe' },
    ])
  })
})
