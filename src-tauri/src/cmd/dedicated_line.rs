use super::CmdResult;
use crate::{
    cmd::StringifyErr as _,
    config::{Config, DedicatedLineConfig, IVerge},
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
    let port = Config::verge().await.latest_arc().verge_mixed_port.unwrap_or(7897);
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
        .stringify_err()?;

    let ip = resp.text().await.stringify_err()?;
    Ok(ip.trim().into())
}
