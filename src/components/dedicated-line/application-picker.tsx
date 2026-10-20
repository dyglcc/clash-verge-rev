import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'

import {
  getDedicatedLineProcesses,
  type DedicatedLineApplication,
} from '@/services/cmds'
import { pickDedicatedLineApplications } from '@/services/dedicated-line-picker'
import { showNotice } from '@/services/notice-service'
import { useQuery } from '@/services/query-client'

export const DedicatedLineApplicationPicker = ({
  open,
  onClose,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  onSelect: (applications: DedicatedLineApplication[]) => void
}) => {
  const [search, setSearch] = useState('')
  const {
    data: applications = [],
    isFetching: loading,
    error,
  } = useQuery({
    queryKey: ['getDedicatedLineProcesses'],
    queryFn: getDedicatedLineProcesses,
    enabled: open,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
  const chooseFiles = async () => {
    try {
      const selected = await pickDedicatedLineApplications()
      if (selected.length) {
        onSelect(selected)
        onClose()
      }
    } catch (error: unknown) {
      showNotice.error(error)
    }
  }
  const query = search.trim().toLowerCase()
  const visible = applications.filter((application) =>
    `${application.name} ${application.path}`.toLowerCase().includes(query),
  )
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>选择走专线的应用</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && (
            <Alert severity="warning">
              无法读取运行中的应用，请使用“浏览应用程序”。
            </Alert>
          )}
          <Alert severity="info">
            Windows 下可从运行中的应用选择，也可浏览可执行文件。Bookmap 等 Java
            应用请选实际联网的进程，通常是其安装目录中的
            javaw.exe；仅选择启动器可能无法匹配。同一可执行文件启动的多个应用会一起匹配。
          </Alert>
          <TextField
            label="搜索应用名称或完整路径"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            size="small"
            fullWidth
          />
          {loading ? (
            <CircularProgress size={24} />
          ) : (
            <List sx={{ maxHeight: 360, overflow: 'auto' }}>
              {visible.map((application) => (
                <ListItemButton
                  key={application.path}
                  onClick={() => {
                    onSelect([application])
                    onClose()
                  }}
                >
                  <ListItemText
                    primary={application.name}
                    secondary={application.path}
                    slotProps={{
                      secondary: { sx: { wordBreak: 'break-all' } },
                    }}
                  />
                </ListItemButton>
              ))}
              {visible.length === 0 && (
                <Typography color="text.secondary">
                  没有匹配的运行中应用，请使用“浏览应用程序”。
                </Typography>
              )}
            </List>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={chooseFiles}>
          浏览应用程序
        </Button>
      </DialogActions>
    </Dialog>
  )
}
