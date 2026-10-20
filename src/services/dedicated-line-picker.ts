import { open } from '@tauri-apps/plugin-dialog'

import getSystem from '@/utils/get-system'

import type { DedicatedLineApplication } from './cmds'

export async function pickDedicatedLineApplications(): Promise<
  DedicatedLineApplication[]
> {
  const selected = await open({
    multiple: true,
    directory: false,
    title: '选择需要走专线的应用程序',
    filters:
      getSystem() === 'windows'
        ? [{ name: '应用程序', extensions: ['exe'] }]
        : undefined,
  })
  if (!selected) return []
  return (Array.isArray(selected) ? selected : [selected]).map((path) => ({
    name: path.split(/[\\/]/).pop() || path,
    path,
  }))
}
