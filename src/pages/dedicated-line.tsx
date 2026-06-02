import {
  LinkOffRounded,
  LinkRounded,
  NetworkCheckRounded,
  SaveRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useMemo, useState } from 'react'
import {
  closeAllConnections,
  selectNodeForGroup,
} from 'tauri-plugin-mihomo-api'

import { BasePage } from '@/components/base'
import {
  useAppRefreshers,
  useClashConfigData,
  useProxiesData,
} from '@/providers/app-data-context'
import {
  DedicatedLineConfig,
  getDedicatedLine,
  patchDedicatedLine,
  verifyDedicatedLineIp,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

// 注入到 proxies 的固定出口节点名（需与后端 enhance/dedicated_line.rs 的默认值一致）
const EXIT_NAME = '专线出口'

const DedicatedLinePage = () => {
  const { proxies } = useProxiesData()
  const { clashConfig } = useClashConfigData()
  const { refreshProxy } = useAppRefreshers()

  const [form, setForm] = useState<DedicatedLineConfig>({
    name: EXIT_NAME,
    proxy_type: 'socks5',
    server: '',
    port: undefined,
    username: '',
    password: '',
    udp: true,
    skip_cert_verify: false,
    enabled: false,
  })
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [dialog, setDialog] = useState<{
    open: boolean
    ok: boolean
    ip: string
  }>({ open: false, ok: false, ip: '' })

  const connected = !!form.enabled

  // 载入已保存的专线配置
  useEffect(() => {
    getDedicatedLine()
      .then((cfg) => {
        if (cfg) {
          setForm((prev) => ({
            ...prev,
            ...cfg,
            name: cfg.name || EXIT_NAME,
            proxy_type: cfg.proxy_type || 'socks5',
          }))
        }
      })
      .catch(() => {})
  }, [])

  // 根据当前模式探测「入口节点 + 作用组」
  const mode = clashConfig?.mode
  const detected = useMemo<{ group: string; entry?: string } | null>(() => {
    if (!proxies) return null
    if (mode === 'global') {
      return { group: 'GLOBAL', entry: proxies.global?.now }
    }
    const g = proxies.groups?.[0]
    if (!g) return null
    return { group: g.name, entry: g.now }
  }, [proxies, mode])

  const update = (patch: Partial<DedicatedLineConfig>) =>
    setForm((prev) => ({ ...prev, ...patch }))

  const validateForm = (): string | null => {
    if (!form.server?.trim()) return '请填写专线 IP'
    if (!form.port || form.port <= 0 || form.port > 65535)
      return '请填写有效端口 (1-65535)'
    if (!form.proxy_type) return '请选择协议'
    return null
  }

  // 保存配置（不改变连接状态）
  const onSave = useLockFn(async () => {
    const err = validateForm()
    if (err) {
      showNotice.error(err)
      return
    }
    setLoading(true)
    try {
      const cfg = { ...form, name: form.name || EXIT_NAME }
      await patchDedicatedLine(cfg)
      setForm(cfg)
      showNotice.success('专线配置已保存')
    } catch (e: any) {
      showNotice.error('保存失败: ' + e)
    } finally {
      setLoading(false)
    }
  })

  // 连接专线：入口=当前选中节点，出口=专线 IP
  const onConnect = useLockFn(async () => {
    const err = validateForm()
    if (err) {
      showNotice.error(err)
      return
    }
    if (!detected?.entry) {
      showNotice.error('未检测到入口节点，请先在「代理」页选好一个节点')
      return
    }
    setLoading(true)
    try {
      const cfg: DedicatedLineConfig = {
        ...form,
        name: form.name || EXIT_NAME,
        enabled: true,
        entry_node: detected.entry,
        group: detected.group,
      }
      // 写入配置并重新生成核心配置（enhance 注入专线出口 + dialer-proxy）
      await patchDedicatedLine(cfg)
      // 选中专线出口
      await selectNodeForGroup(detected.group, cfg.name as string)
      await closeAllConnections()
      await refreshProxy()
      setForm(cfg)
      showNotice.success(
        `专线已连接（入口: ${detected.entry} → 出口: ${form.server}）`,
      )
    } catch (e: any) {
      showNotice.error('连接失败: ' + e)
    } finally {
      setLoading(false)
    }
  })

  // 断开专线：恢复为入口节点
  const onDisconnect = useLockFn(async () => {
    setLoading(true)
    try {
      const group = form.group || 'GLOBAL'
      const entry = form.entry_node
      const cfg = { ...form, enabled: false }
      await patchDedicatedLine(cfg)
      if (entry) {
        try {
          await selectNodeForGroup(group, entry)
        } catch {
          // ignore
        }
      }
      await closeAllConnections()
      await refreshProxy()
      setForm(cfg)
      showNotice.success('专线已断开')
    } catch (e: any) {
      showNotice.error('断开失败: ' + e)
    } finally {
      setLoading(false)
    }
  })

  // 验证出口 IP
  const onVerify = useLockFn(async () => {
    setVerifying(true)
    try {
      const ip = await verifyDedicatedLineIp()
      const ok = !!form.server && ip === form.server.trim()
      setDialog({ open: true, ok, ip })
    } catch (e: any) {
      showNotice.error('验证失败: ' + e)
    } finally {
      setVerifying(false)
    }
  })

  return (
    <BasePage title="专线代理">
      <Stack spacing={2} sx={{ maxWidth: 640, mx: 'auto' }}>
        <Alert severity="info">
          专线代理是「链式代理」的简化封装：连接后，你在「代理」页选中的节点作为
          <b>入口</b>，下面录入的专线 IP 作为<b>出口</b>
          。一次录入长期保存，重启后保持， 直到你手动断开。
        </Alert>

        {/* 状态卡片 */}
        <Card variant="outlined" sx={{ p: 2 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Typography variant="h6">专线状态</Typography>
            <Chip
              label={connected ? '已连接' : '未连接'}
              color={connected ? 'success' : 'default'}
              size="small"
            />
          </Box>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 1, wordBreak: 'break-all' }}
          >
            当前模式：{mode || '未知'} | 作用组：{detected?.group || '—'}
            <br />
            检测到的入口节点：
            {detected?.entry || '（未选择，请先到代理页选节点）'}
            {connected && form.entry_node && (
              <>
                <br />
                已连接入口：{form.entry_node} → 出口：{form.server}
              </>
            )}
          </Typography>
        </Card>

        {/* 录入表单 */}
        <Card variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            专线出口配置
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="协议"
              select
              size="small"
              fullWidth
              value={form.proxy_type || 'socks5'}
              onChange={(e) => update({ proxy_type: e.target.value })}
            >
              <MenuItem value="socks5">SOCKS5</MenuItem>
              <MenuItem value="http">HTTP</MenuItem>
            </TextField>
            <TextField
              label="专线 IP / 服务器地址"
              size="small"
              fullWidth
              placeholder="例如 1.2.3.4"
              value={form.server || ''}
              onChange={(e) => update({ server: e.target.value })}
            />
            <TextField
              label="端口"
              size="small"
              fullWidth
              type="number"
              value={form.port ?? ''}
              onChange={(e) =>
                update({
                  port: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
            <TextField
              label="用户名（可选）"
              size="small"
              fullWidth
              value={form.username || ''}
              onChange={(e) => update({ username: e.target.value })}
            />
            <TextField
              label="密码（可选）"
              size="small"
              fullWidth
              type="password"
              value={form.password || ''}
              onChange={(e) => update({ password: e.target.value })}
            />
          </Stack>

          <Stack direction="row" spacing={1.5} sx={{ mt: 2.5 }}>
            <Button
              variant="outlined"
              startIcon={<SaveRounded />}
              disabled={loading}
              onClick={onSave}
            >
              保存配置
            </Button>
            {connected ? (
              <Button
                variant="contained"
                color="error"
                startIcon={<LinkOffRounded />}
                disabled={loading}
                onClick={onDisconnect}
              >
                断开专线
              </Button>
            ) : (
              <Button
                variant="contained"
                color="success"
                startIcon={<LinkRounded />}
                disabled={loading}
                onClick={onConnect}
              >
                连接专线
              </Button>
            )}
            <Box sx={{ flex: 1 }} />
            <Button
              variant="outlined"
              startIcon={
                verifying ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <NetworkCheckRounded />
                )
              }
              disabled={verifying}
              onClick={onVerify}
            >
              验证专线
            </Button>
          </Stack>
        </Card>
      </Stack>

      {/* 验证结果弹窗 */}
      <Dialog
        open={dialog.open}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
      >
        <DialogTitle>{dialog.ok ? '🎉 验证成功' : '⚠️ 尚未生效'}</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            {dialog.ok ? (
              <>恭喜，专线 IP 配置成功！</>
            ) : (
              <>当前出口 IP 还不是专线 IP。</>
            )}
            <Box sx={{ mt: 1.5, fontFamily: 'monospace' }}>
              当前出口 IP：<b>{dialog.ip || '—'}</b>
              <br />
              专线 IP：<b>{form.server || '—'}</b>
            </Box>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog((d) => ({ ...d, open: false }))}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>
    </BasePage>
  )
}

export default DedicatedLinePage
