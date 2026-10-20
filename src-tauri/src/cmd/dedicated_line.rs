use super::CmdResult;
use crate::{
    cmd::StringifyErr as _,
    config::{Config, DedicatedLineApplication, DedicatedLineConfig, IVerge, MixedPort},
    feat,
};
use smartstring::alias::String;

/// 读取专线代理配置
#[tauri::command]
pub async fn get_dedicated_line() -> CmdResult<Option<DedicatedLineConfig>> {
    Ok(Config::verge().await.latest_arc().dedicated_line.clone())
}

/// 保存 / 连接 / 断开 专线代理。
///
/// 前端传入完整的 `DedicatedLineConfig`（含 `enabled`、`entry_node`、`group`）：
/// - 保存表单：`enabled` 维持原值或 false；
/// - 连接：`enabled=true` 并带上当时选中的入口节点与作用组；
/// - 断开：`enabled=false`。
///
/// 写入 verge 配置后触发核心配置重新生成，`enhance()` 会按 `enabled` 注入或移除专线出口。
#[tauri::command]
pub async fn patch_dedicated_line(config: DedicatedLineConfig) -> CmdResult<()> {
    let patch = IVerge {
        dedicated_line: Some(config),
        ..IVerge::default()
    };
    feat::patch_verge(&patch, false).await.stringify_err()
}

/// 验证当前出口 IP。
///
/// 经 clash 的 mixed-port 显式走代理请求 `ifconfig.me`，返回出口 IP 字符串。
/// 这样验证的是「链路本身」是否生效，不依赖是否开启 TUN / 系统代理。
#[tauri::command]
pub async fn verify_dedicated_line_ip() -> CmdResult<String> {
    let line = Config::verge().await.data_arc().dedicated_line.clone();
    if !line.as_ref().is_some_and(|line| line.enabled == Some(true)) {
        return Err("The dedicated line is not connected".into());
    }
    let port = if line.as_ref().is_some_and(DedicatedLineConfig::targets_applications) {
        Config::runtime()
            .await
            .latest_arc()
            .config
            .as_ref()
            .and_then(crate::enhance::dedicated_line::verification_port)
            .ok_or_else(|| super::CommandFailure::plain("Dedicated line verification listener is unavailable"))?
    } else {
        MixedPort::effective().await
    };
    let proxy_url = format!("http://127.0.0.1:{port}");

    let proxy = reqwest::Proxy::all(&proxy_url).stringify_err()?;
    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .stringify_err()?;

    // 用 curl 风格 UA，ifconfig.me 会直接返回纯文本 IP
    let resp = client
        .get("https://ifconfig.me/ip")
        .header("User-Agent", "curl/8.0.0")
        .send()
        .await
        .stringify_err()?
        .error_for_status()
        .stringify_err()?;

    let ip = resp.text().await.stringify_err()?;
    let ip = ip.trim().parse::<std::net::IpAddr>().stringify_err()?;
    Ok(ip.to_string().into())
}

#[tauri::command]
pub async fn get_dedicated_line_processes() -> CmdResult<Vec<DedicatedLineApplication>> {
    #[cfg(target_os = "windows")]
    {
        tokio::task::spawn_blocking(running_applications)
            .await
            .stringify_err()?
            .stringify_err()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}

#[cfg(target_os = "windows")]
fn running_applications() -> anyhow::Result<Vec<DedicatedLineApplication>> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
            },
            Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW},
        },
    };
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error().into());
    }
    let mut applications = std::collections::BTreeMap::new();
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut available = unsafe { Process32FirstW(snapshot, &mut entry) };
    while available != 0 {
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID) };
        if !process.is_null() {
            let mut path = vec![0u16; 32768];
            let mut size = path.len() as u32;
            if unsafe { QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut size) } != 0 {
                let path = std::string::String::from_utf16_lossy(&path[..size as usize]);
                let name_end = entry
                    .szExeFile
                    .iter()
                    .position(|character| *character == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = std::string::String::from_utf16_lossy(&entry.szExeFile[..name_end]);
                applications
                    .entry(path.to_lowercase())
                    .or_insert(DedicatedLineApplication {
                        name: name.into(),
                        path: path.into(),
                    });
            }
            unsafe { CloseHandle(process) };
        }
        available = unsafe { Process32NextW(snapshot, &mut entry) };
    }
    unsafe { CloseHandle(snapshot) };
    Ok(applications.into_values().collect())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    #[test]
    fn application_picker_includes_the_current_executable() -> anyhow::Result<()> {
        let current = std::env::current_exe()?;
        let applications = super::running_applications()?;
        assert!(
            applications
                .iter()
                .any(|application| application.path.eq_ignore_ascii_case(&current.to_string_lossy()))
        );
        Ok(())
    }
}
