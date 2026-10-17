import type { ProxyViewV1 } from '@/types/proxy-view'

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
