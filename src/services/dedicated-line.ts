import type { ProxyViewV1 } from '@/types/proxy-view'

import type { DedicatedLineApplication } from './cmds'

export function normalizeDedicatedLineDomains(domains: string[]): string[] {
  const normalized = new Set<string>()
  for (const input of domains) {
    const domain = input.trim().toLowerCase().replace(/\.$/, '')
    if (!domain) {
      if (input.trim()) throw new Error('Invalid dedicated-line domain')
      continue
    }
    const labels = domain.split('.')
    if (
      domain.length > 253 ||
      labels.length < 2 ||
      !/[a-z]/.test(domain) ||
      labels.some(
        (label) =>
          label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      )
    )
      throw new Error('Invalid dedicated-line domain')
    normalized.add(domain)
  }
  return [...normalized]
}

export function mergeDedicatedLineApplications(
  current: DedicatedLineApplication[],
  additions: DedicatedLineApplication[],
  windows: boolean,
): DedicatedLineApplication[] {
  const applications = new Map<string, DedicatedLineApplication>()
  for (const application of [...current, ...additions]) {
    const path = application.path.trim()
    if (path)
      applications.set(windows ? path.toLowerCase() : path, {
        ...application,
        path,
      })
  }
  return [...applications.values()]
}

export function detectDedicatedLineEntry(
  view: ProxyViewV1 | undefined,
  mode: string | undefined,
  selectedGroup: string,
): { group: string; entry?: string } | null {
  if (!view || (mode !== 'rule' && mode !== 'global')) return null
  const group =
    mode === 'global'
      ? view.global
      : (view.groups.find(
          (item) => item.name === selectedGroup && item.type === 'Selector',
        ) ?? view.groups.find((item) => item.type === 'Selector'))
  if (!group) return null
  let entry = group.now
  const visited = new Set([group.name])
  while (entry) {
    if (visited.has(entry)) return null
    visited.add(entry)
    const nested = view.groups.find((item) => item.name === entry)
    if (!nested) break
    entry = nested.now
  }
  return { group: group.name, entry }
}
