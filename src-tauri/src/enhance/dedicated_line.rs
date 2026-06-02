use crate::config::{Config, DedicatedLineConfig};
use clash_verge_logging::{Type, logging};
use serde_yaml_ng::{Mapping, Value};

/// 默认的专线出口节点名
pub const DEFAULT_EXIT_NAME: &str = "专线出口";

/// 在配置生成管线末尾应用「专线代理」。
///
/// 当 `verge.dedicated_line.enabled == true` 时：
/// 1. 向 `proxies` 注入专线出口节点（socks5 / http）；
/// 2. 把出口加入目标组（以及 GLOBAL，保证可被选中）；
/// 3. 在出口节点上设置 `dialer-proxy = entry_node`，形成 入口→出口 链路。
///
/// 因为本函数在每次 `enhance()`（启动、切订阅、改设置）都会执行，
/// 故只要 `enabled` 仍为 true，重启后链路会自动重建。
pub async fn apply_dedicated_line(mut config: Mapping) -> Mapping {
    let dl = Config::verge().await.latest_arc().dedicated_line.clone();
    let Some(dl) = dl else {
        return config;
    };

    if dl.enabled != Some(true) {
        return config;
    }

    // 提取并校验必填项
    let proxy_type = dl.proxy_type.clone().unwrap_or_default();
    let server = dl.server.clone().unwrap_or_default();
    let port = dl.port.unwrap_or(0);
    let entry_node = dl.entry_node.clone().unwrap_or_default();
    let group = dl.group.clone().unwrap_or_default();
    let exit_name = dl
        .name
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_EXIT_NAME.into());

    if server.is_empty()
        || port == 0
        || entry_node.is_empty()
        || group.is_empty()
        || !matches!(proxy_type.as_str(), "socks5" | "http")
    {
        logging!(
            warn,
            Type::Core,
            "专线代理已启用但配置不完整（type={proxy_type} server={server} port={port} entry={entry_node} group={group}），跳过注入"
        );
        return config;
    }

    // 1) 构造专线出口代理并注入 proxies
    let exit_proxy = build_exit_proxy(&dl, &exit_name, &proxy_type, &server, port, &entry_node);
    inject_proxy(&mut config, &exit_name, exit_proxy);

    // 2) 加入目标组（以及 GLOBAL）
    add_to_group(&mut config, &group, &exit_name);
    if group != "GLOBAL" {
        add_to_group(&mut config, "GLOBAL", &exit_name);
    }

    logging!(
        info,
        Type::Core,
        "专线代理已注入：出口={exit_name} 入口={entry_node} 组={group}"
    );
    config
}

/// 构造专线出口代理节点（mihomo proxy 定义）
fn build_exit_proxy(
    dl: &DedicatedLineConfig,
    name: &str,
    proxy_type: &str,
    server: &str,
    port: u16,
    entry_node: &str,
) -> Value {
    let mut m = Mapping::new();
    m.insert(Value::from("name"), Value::from(name));
    m.insert(Value::from("type"), Value::from(proxy_type));
    m.insert(Value::from("server"), Value::from(server));
    m.insert(Value::from("port"), Value::from(port as u64));

    if let Some(u) = dl.username.as_deref().filter(|s| !s.is_empty()) {
        m.insert(Value::from("username"), Value::from(u));
    }
    if let Some(p) = dl.password.as_deref().filter(|s| !s.is_empty()) {
        m.insert(Value::from("password"), Value::from(p));
    }
    if let Some(udp) = dl.udp {
        m.insert(Value::from("udp"), Value::from(udp));
    }
    // http(s) 代理：需要时开启 tls + 跳过证书校验
    if proxy_type == "http" && dl.skip_cert_verify == Some(true) {
        m.insert(Value::from("tls"), Value::from(true));
        m.insert(Value::from("skip-cert-verify"), Value::from(true));
    }

    // 关键：链式 dialer-proxy 指向入口节点
    m.insert(Value::from("dialer-proxy"), Value::from(entry_node));

    Value::Mapping(m)
}

/// 向 `proxies` 注入出口节点（同名先移除，避免重复）
fn inject_proxy(config: &mut Mapping, name: &str, proxy: Value) {
    if !config.contains_key("proxies") {
        config.insert(Value::from("proxies"), Value::Sequence(vec![]));
    }
    if let Some(Value::Sequence(seq)) = config.get_mut("proxies") {
        seq.retain(|p| p.get("name").and_then(|v| v.as_str()) != Some(name));
        seq.push(proxy);
    }
}

/// 把出口节点名加入指定代理组的 `proxies` 列表（已存在则跳过）
fn add_to_group(config: &mut Mapping, group: &str, exit_name: &str) {
    let Some(Value::Sequence(groups)) = config.get_mut("proxy-groups") else {
        return;
    };
    for g in groups.iter_mut() {
        let Value::Mapping(gm) = g else {
            continue;
        };
        if gm.get("name").and_then(|v| v.as_str()) != Some(group) {
            continue;
        }
        if !gm.contains_key("proxies") {
            gm.insert(Value::from("proxies"), Value::Sequence(vec![]));
        }
        if let Some(Value::Sequence(ps)) = gm.get_mut("proxies")
            && !ps.iter().any(|p| p.as_str() == Some(exit_name))
        {
            ps.push(Value::from(exit_name));
        }
    }
}
