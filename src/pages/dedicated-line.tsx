import {
  LinkOffRounded,
  LinkRounded,
  NetworkCheckRounded,
  SaveRounded,
  AddRounded,
  DeleteOutlineRounded,
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
  IconButton,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useMemo, useState } from 'react'
import {
  closeAllConnections,
  selectNodeForGroup,
} from 'tauri-plugin-mihomo-api'

import { BasePage } from '@/components/base'
import { DedicatedLineApplicationPicker } from '@/components/dedicated-line/application-picker'
import { useVerge } from '@/hooks/use-verge'
import {
  useAppRefreshers,
  useClashConfigData,
  useProxiesData,
} from '@/providers/app-data-context'
import {
  DedicatedLineConfig,
  getDedicatedLine,
  patchDedicatedLine,
  recordSelectedNode,
  verifyDedicatedLineIp,
} from '@/services/cmds'
import {
  detectDedicatedLineEntry,
  mergeDedicatedLineApplications,
  normalizeDedicatedLineDomains,
} from '@/services/dedicated-line'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'
import getSystem from '@/utils/get-system'

// 注入到 proxies 的固定出口节点名（需与后端 enhance/dedicated_line.rs 的默认值一致）
const EXIT_NAME = '专线出口'

const DedicatedLinePage = () => {
  const { proxyView } = useProxiesData()
  const { clashConfig } = useClashConfigData()
  const { refreshProxy, refreshClashConfig, refreshRules } = useAppRefreshers()
  const { verge, patchVerge } = useVerge()
  const [selectedGroup, setSelectedGroup] = useState('')
  const [applicationPickerOpen, setApplicationPickerOpen] = useState(false)

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
    scope: 'applications',
    domains: [],
    applications: [],
  })
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [dialog, setDialog] = useState<{
    open: boolean
    ok: boolean
    ip: string
  }>({ open: false, ok: false, ip: '' })

  const connected = !!verge?.dedicated_line?.enabled
  const applicationOnly = form.scope === 'applications'
  const requiresTun = applicationOnly && !!form.applications?.length
  const connectedRequiresTun =
    verge?.dedicated_line?.scope === 'applications' &&
    !!verge.dedicated_line.applications?.length
  const domainInput = useMemo(() => {
    try {
      return {
        domains: normalizeDedicatedLineDomains(form.domains || []),
        error: '',
      }
    } catch {
      return {
        domains: [],
        error:
          '请每行填写一个有效域名，不含网址前缀、路径、通配符或 IP；国际化域名请使用 Punycode。',
      }
    }
  }, [form.domains])
  const refresh = () =>
    Promise.all([refreshProxy(), refreshClashConfig(), refreshRules()])

  // 载入已保存的专线配置
  useEffect(() => {
    getDedicatedLine()
      .then((cfg) => {
        if (cfg) {
          setSelectedGroup(cfg.group || '')
          setForm((prev) => ({
            ...prev,
            ...cfg,
            name: cfg.name || EXIT_NAME,
            proxy_type: cfg.proxy_type || 'socks5',
            scope: cfg.scope || 'all',
          }))
        }
      })
      .catch((error: unknown) => showNotice.error(error))
      .finally(() => setLoading(false))
  }, [])

  // 根据当前模式探测「入口节点 + 作用组」
  const mode = clashConfig?.mode?.toLowerCase()
  const groups = useMemo(
    () => proxyView?.groups.filter((group) => group.type === 'Selector') ?? [],
    [proxyView],
  )
  const detected = useMemo(
    () =>
      detectDedicatedLineEntry(
        proxyView,
        applicationOnly && mode === 'direct' ? 'rule' : mode,
        selectedGroup,
      ),
    [proxyView, mode, selectedGroup, applicationOnly],
  )

  const update = (patch: Partial<DedicatedLineConfig>) =>
    setForm((prev) => ({ ...prev, ...patch }))

  const validateForm = (requireTun = false): string | null => {
    if (!form.server?.trim()) return '请填写专线 IP'
    if (
      !form.port ||
      !Number.isInteger(form.port) ||
      form.port <= 0 ||
      form.port > 65535
    )
      return '请填写有效端口 (1-65535)'
    if (!['socks5', 'http'].includes(form.proxy_type ?? '')) return '请选择协议'
    if (applicationOnly && domainInput.error) return domainInput.error
    if (
      applicationOnly &&
      !domainInput.domains.length &&
      !form.applications?.length
    )
      return '请至少添加一个走专线的域名或应用'
    if (requireTun && requiresTun && !verge?.enable_tun_mode)
      return '应用进程兜底需要开启虚拟网卡（TUN）模式'
    if (
      applicationOnly &&
      form.applications?.some((application) => /[,\r\n]/.test(application.path))
    )
      return '应用路径不能包含逗号或换行'
    return null
  }

  // 保存配置（不改变连接状态）
  const onSave = useLockFn(async () => {
    const err = validateForm(connected)
    if (err) {
      showNotice.error(err)
      return
    }
    setLoading(true)
    try {
      const cfg = {
        ...form,
        domains: applicationOnly ? domainInput.domains : form.domains,
        server: form.server?.trim(),
        name: form.name || EXIT_NAME,
        enabled: connected,
      }
      await mutate(() => patchDedicatedLine(cfg), {
        id: 'patch-verge-config',
        revalidate: [['getVergeConfig']],
        errorNotice: false,
      })
      const previous = verge?.dedicated_line
      if (
        connected &&
        applicationOnly &&
        previous?.scope !== 'applications' &&
        previous?.group &&
        previous.entry_node
      ) {
        await mutate(
          async () => {
            await selectNodeForGroup(previous.group!, previous.entry_node!)
            await recordSelectedNode(previous.group!, previous.entry_node!)
          },
          { id: `select-proxy-node:${previous.group}`, errorNotice: false },
        )
      } else if (
        connected &&
        !applicationOnly &&
        previous?.scope === 'applications' &&
        cfg.group
      ) {
        await mutate(
          async () => {
            await selectNodeForGroup(cfg.group!, cfg.name)
            await recordSelectedNode(cfg.group!, cfg.name)
          },
          { id: `select-proxy-node:${cfg.group}`, errorNotice: false },
        )
      }
      if (
        connected &&
        applicationOnly !== (previous?.scope === 'applications')
      ) {
        await mutate(() => closeAllConnections(), {
          id: 'close-all-connections',
          errorNotice: false,
        })
      }
      await refresh()
      setForm(cfg)
      showNotice.success(
        applicationOnly
          ? '设置已保存，请重连目标应用或登录页面，使已有连接按新规则建立'
          : '专线配置已保存',
      )
    } catch (error: unknown) {
      showNotice.error(error)
    } finally {
      setLoading(false)
    }
  })

  // 连接专线：入口=当前选中节点，出口=专线 IP
  const onConnect = useLockFn(async () => {
    const err = validateForm(true)
    if (err) {
      showNotice.error(err)
      return
    }
    if (!detected?.entry) {
      showNotice.error('未检测到入口节点，请先在「代理」页选好一个节点')
      return
    }
    if (localStorage.getItem('proxy-chain-mode-enabled') === 'true') {
      showNotice.error('请先在「代理」页关闭链式代理模式')
      return
    }
    if (
      [
        'DIRECT',
        'REJECT',
        'REJECT-DROP',
        'PASS',
        form.name || EXIT_NAME,
      ].includes(detected.entry)
    ) {
      showNotice.error('请选择一个有效的代理节点作为入口')
      return
    }
    setLoading(true)
    try {
      const cfg: DedicatedLineConfig = {
        ...form,
        domains: applicationOnly ? domainInput.domains : form.domains,
        server: form.server?.trim(),
        name: form.name || EXIT_NAME,
        enabled: true,
        entry_node: detected.entry,
        group: detected.group,
      }
      // 写入配置并重新生成核心配置（enhance 注入专线出口 + dialer-proxy）
      await mutate(() => patchDedicatedLine(cfg), {
        id: 'patch-verge-config',
        revalidate: [['getVergeConfig']],
        errorNotice: false,
      })
      setForm(cfg)
      if (!applicationOnly) {
        await mutate(
          async () => {
            await selectNodeForGroup(detected.group, cfg.name || EXIT_NAME)
            await recordSelectedNode(detected.group, cfg.name || EXIT_NAME)
          },
          { id: `select-proxy-node:${detected.group}`, errorNotice: false },
        )
        await mutate(() => closeAllConnections(), {
          id: 'close-all-connections',
          errorNotice: false,
        })
      }
      await refresh()
      showNotice.success(
        applicationOnly
          ? '域名与应用分流已启用，请重连已有连接；其他流量沿用当前模式'
          : `专线已连接（入口: ${detected.entry} → 出口: ${form.server}）`,
      )
    } catch (error: unknown) {
      showNotice.error(error)
    } finally {
      setLoading(false)
    }
  })

  // 断开专线：恢复为入口节点
  const onDisconnect = useLockFn(async () => {
    setLoading(true)
    try {
      const saved = verge?.dedicated_line
      const group = saved?.group || 'GLOBAL'
      const entry = saved?.entry_node
      const cfg = { ...saved, enabled: false }
      await mutate(() => patchDedicatedLine(cfg), {
        id: 'patch-verge-config',
        revalidate: [['getVergeConfig']],
        errorNotice: false,
      })
      setForm((previous) => ({ ...previous, enabled: false }))
      if (entry && saved?.scope !== 'applications') {
        await mutate(
          async () => {
            await selectNodeForGroup(group, entry)
            await recordSelectedNode(group, entry)
          },
          { id: `select-proxy-node:${group}`, errorNotice: false },
        )
      }
      if (saved?.scope !== 'applications')
        await mutate(() => closeAllConnections(), {
          id: 'close-all-connections',
          errorNotice: false,
        })
      await refresh()
      setForm(cfg)
      showNotice.success(
        saved?.scope === 'applications'
          ? '域名与应用分流已停用，请重连目标应用或浏览器以结束已有专线连接'
          : '专线已断开',
      )
    } catch (error: unknown) {
      showNotice.error(error)
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
    } catch (error: unknown) {
      showNotice.error(error)
    } finally {
      setVerifying(false)
    }
  })

  return (
    <BasePage title="专线代理">
      <Stack spacing={2} sx={{ maxWidth: 640, mx: 'auto' }}>
        <Alert severity="info">
          专线使用“入口节点 →
          专线出口”的链式代理。选择“指定域名与应用”后，优先按域名走专线，应用名单作为兜底。其他流量继续遵循当前全局、规则或直连模式。设置会保存，重启
          Clash 后仍然有效。
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
              label={
                connected
                  ? connectedRequiresTun && !verge?.enable_tun_mode
                    ? '等待开启 TUN'
                    : '已连接'
                  : '未连接'
              }
              color={
                connected
                  ? connectedRequiresTun && !verge?.enable_tun_mode
                    ? 'warning'
                    : 'success'
                  : 'default'
              }
              size="small"
            />
          </Box>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 1, wordBreak: 'break-all' }}
          >
            当前模式：{mode || '未知'} | {applicationOnly ? '入口组' : '作用组'}
            ：{(connected ? form.group : detected?.group) || '—'}
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
              select
              label="专线作用范围"
              size="small"
              fullWidth
              value={form.scope || 'all'}
              disabled={loading}
              onChange={(event) =>
                update({ scope: event.target.value as 'all' | 'applications' })
              }
            >
              <MenuItem value="applications">指定域名与应用</MenuItem>
              <MenuItem value="all">全部流量（原有方式）</MenuItem>
            </TextField>
            {applicationOnly && (
              <Stack spacing={1}>
                <TextField
                  label="优先走专线的域名"
                  multiline
                  minRows={3}
                  fullWidth
                  disabled={loading}
                  placeholder={'example.com\nlogin.other-site.com'}
                  value={(form.domains || []).join('\n')}
                  error={!!domainInput.error}
                  helperText={
                    domainInput.error ||
                    '每行一个域名，覆盖该域名及所有子域名。不填写 https://、路径或通配符。'
                  }
                  onChange={(event) =>
                    update({ domains: event.target.value.split(/\r?\n/) })
                  }
                />
                <Alert severity="info">
                  指定域名在 Chrome
                  等浏览器中也会走专线。第三方登录使用独立域名时需要另行添加，无需把整个
                  Chrome 加入应用名单。
                </Alert>
                <Typography variant="subtitle2">应用兜底（可选）</Typography>
                <Typography variant="body2" color="text.secondary">
                  域名未命中时，名单中的应用仍走专线，包括直接连接 IP 的请求。
                </Typography>
                <Alert
                  severity={
                    requiresTun && !verge?.enable_tun_mode ? 'warning' : 'info'
                  }
                  action={
                    !verge?.enable_tun_mode && (
                      <Button
                        disabled={loading}
                        onClick={async () => {
                          setLoading(true)
                          try {
                            await patchVerge({ enable_tun_mode: true })
                            await refresh()
                          } catch (error: unknown) {
                            showNotice.error(error)
                          } finally {
                            setLoading(false)
                          }
                        }}
                      >
                        开启 TUN
                      </Button>
                    )
                  }
                >
                  {verge?.enable_tun_mode
                    ? '设置只影响新连接；保存并连接后，请重连目标应用和登录页面。'
                    : requiresTun
                      ? '应用进程兜底需要开启虚拟网卡（TUN）模式，才能接管不使用系统代理的应用。'
                      : '仅按域名分流可使用系统代理。未经过 Clash 的请求无法接管；需要应用进程兜底时请开启 TUN。'}
                </Alert>
                {(form.applications || []).map((application) => (
                  <Box
                    key={application.path}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography>{application.name}</Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ wordBreak: 'break-all' }}
                      >
                        {application.path}
                      </Typography>
                    </Box>
                    <IconButton
                      aria-label={`移除 ${application.name}`}
                      disabled={loading}
                      onClick={() =>
                        update({
                          applications: form.applications?.filter(
                            (item) => item.path !== application.path,
                          ),
                        })
                      }
                    >
                      <DeleteOutlineRounded />
                    </IconButton>
                  </Box>
                ))}
                {!form.applications?.length && (
                  <Typography color="text.secondary">
                    尚未添加兜底应用，可仅使用域名分流。
                  </Typography>
                )}
                <Button
                  startIcon={<AddRounded />}
                  disabled={loading}
                  onClick={() => setApplicationPickerOpen(true)}
                >
                  添加兜底应用
                </Button>
              </Stack>
            )}
            {(mode === 'rule' || (applicationOnly && mode === 'direct')) &&
              groups.length > 0 && (
                <TextField
                  label={applicationOnly ? '入口代理组' : '作用代理组'}
                  select
                  size="small"
                  fullWidth
                  disabled={loading || connected}
                  value={detected?.group || groups[0].name}
                  onChange={(event) => setSelectedGroup(event.target.value)}
                >
                  {groups.map((group) => (
                    <MenuItem key={group.name} value={group.name}>
                      {group.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
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
            {applicationOnly && form.proxy_type === 'http' && (
              <Alert severity="info">
                HTTP 专线不支持 UDP。相关 UDP
                流量会被阻断，不会回退到普通线路；需要 UDP 时，请使用支持 UDP 的
                SOCKS5 入口和出口。
              </Alert>
            )}
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
              disabled={verifying || loading || !connected}
              onClick={onVerify}
            >
              验证专线
            </Button>
          </Stack>
        </Card>
      </Stack>

      <DedicatedLineApplicationPicker
        open={applicationPickerOpen}
        onClose={() => setApplicationPickerOpen(false)}
        onSelect={(applications) =>
          update({
            applications: mergeDedicatedLineApplications(
              form.applications || [],
              applications,
              getSystem() === 'windows',
            ),
          })
        }
      />

      {/* 验证结果弹窗 */}
      <Dialog
        open={dialog.open}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
      >
        <DialogTitle>
          {dialog.ok ? '专线链路验证成功' : '尚未检测到专线出口'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            {dialog.ok ? (
              <>已确认验证请求经过专线出口。</>
            ) : (
              <>当前出口 IP 还不是专线 IP。</>
            )}
            <Box sx={{ mt: 1.5, fontFamily: 'monospace' }}>
              当前出口 IP：<b>{dialog.ip || '—'}</b>
              <br />
              专线 IP：<b>{form.server || '—'}</b>
            </Box>
            {applicationOnly && (
              <Typography variant="body2" sx={{ mt: 1.5 }}>
                链路验证不代表目标请求已命中名单。请重连目标应用或登录页面，并在“连接”页核对域名、进程路径和代理链。
              </Typography>
            )}
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
