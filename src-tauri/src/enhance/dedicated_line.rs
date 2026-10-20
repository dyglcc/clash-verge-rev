use crate::config::{Config, DedicatedLineConfig};
use anyhow::{Result, bail};
use clash_verge_logging::{Type, logging};
use serde_yaml_ng::{Mapping, Value};

pub const VERIFICATION_LISTENER: &str = "cvr-dedicated-line-verification";

pub fn verification_port(config: &Mapping) -> Option<u16> {
    config.get("listeners")?.as_sequence()?.iter().find_map(|listener| {
        (listener.get("name")?.as_str()? == VERIFICATION_LISTENER)
            .then(|| listener.get("port")?.as_u64()?.try_into().ok())
            .flatten()
    })
}

/// 默认的专线出口节点名
pub const DEFAULT_EXIT_NAME: &str = "专线出口";

/// Rebuilds the saved chain after subscription enhancements on startup and reload.
/// Application scope keeps normal selector choices and uses a separate verification inbound.
pub async fn apply_dedicated_line(config: Mapping) -> Result<Mapping> {
    let dl = Config::verge().await.latest_arc().dedicated_line.clone();
    let Some(dl) = dl else {
        return Ok(config);
    };

    let mut config = apply_config(config, &dl)?;
    if dl.enabled == Some(true) && dl.targets_applications() {
        let previous_port = Config::runtime()
            .await
            .latest_arc()
            .config
            .as_ref()
            .and_then(verification_port);
        let port = match previous_port {
            Some(port) => port,
            None => std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?
                .local_addr()?
                .port(),
        };
        let listeners = config
            .entry(Value::from("listeners"))
            .or_insert_with(|| Value::Sequence(vec![]));
        let listeners = listeners
            .as_sequence_mut()
            .ok_or_else(|| anyhow::anyhow!("Invalid listeners configuration"))?;
        if listeners
            .iter()
            .any(|listener| listener.get("name").and_then(Value::as_str) == Some(VERIFICATION_LISTENER))
        {
            bail!("Dedicated line verification listener name is already in use");
        }
        let mut listener = Mapping::new();
        listener.insert("name".into(), VERIFICATION_LISTENER.into());
        listener.insert("type".into(), "mixed".into());
        listener.insert("listen".into(), "127.0.0.1".into());
        listener.insert("port".into(), port.into());
        listener.insert(
            "proxy".into(),
            dl.name
                .as_deref()
                .filter(|name| !name.is_empty())
                .unwrap_or(DEFAULT_EXIT_NAME)
                .into(),
        );
        listeners.push(listener.into());
    }
    Ok(config)
}

fn apply_config(mut config: Mapping, dl: &DedicatedLineConfig) -> Result<Mapping> {
    if dl.enabled != Some(true) {
        return Ok(config);
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
        bail!("Dedicated line configuration is incomplete or uses an unsupported protocol");
    }
    if entry_node == exit_name
        || entry_node == group
        || matches!(entry_node.as_str(), "DIRECT" | "REJECT" | "REJECT-DROP" | "PASS")
    {
        bail!("Select a proxy node as the dedicated line entry");
    }
    if config
        .get("proxies")
        .and_then(Value::as_sequence)
        .is_some_and(|proxies| {
            proxies
                .iter()
                .any(|proxy| proxy.get("name").and_then(Value::as_str) == Some(exit_name.as_str()))
        })
        || config
            .get("proxy-groups")
            .and_then(Value::as_sequence)
            .is_some_and(|groups| {
                groups
                    .iter()
                    .any(|item| item.get("name").and_then(Value::as_str) == Some(exit_name.as_str()))
            })
    {
        bail!("Dedicated line exit name conflicts with an existing proxy or group: {exit_name}");
    }
    if !dl.targets_applications()
        && group != "GLOBAL"
        && !config
            .get("proxy-groups")
            .and_then(Value::as_sequence)
            .is_some_and(|groups| {
                groups.iter().any(|item| {
                    item.get("name").and_then(Value::as_str) == Some(group.as_str())
                        && item.get("type").and_then(Value::as_str) == Some("select")
                })
            })
    {
        bail!("Dedicated line target selector no longer exists: {group}");
    }

    // 1) 构造专线出口代理并注入 proxies
    let exit_proxy = build_exit_proxy(dl, &exit_name, &proxy_type, &server, port, &entry_node);
    inject_proxy(&mut config, &exit_name, exit_proxy);

    if dl.targets_applications() {
        apply_application_rules(&mut config, dl, &exit_name)?;
    } else {
        add_to_group(&mut config, &group, &exit_name);
        if group != "GLOBAL" {
            add_to_group(&mut config, "GLOBAL", &exit_name);
        }
    }

    logging!(
        info,
        Type::Core,
        "专线代理已注入：出口={exit_name} 入口={entry_node} 组={group}"
    );
    Ok(config)
}

fn apply_application_rules(config: &mut Mapping, dl: &DedicatedLineConfig, exit_name: &str) -> Result<()> {
    let applications = dl.applications.as_deref().unwrap_or_default();
    if applications.is_empty() {
        bail!("Select at least one application for the dedicated line");
    }
    if exit_name.contains([',', '\r', '\n']) {
        bail!("Dedicated line name cannot contain commas or newlines");
    }
    let mut rules = Vec::new();
    for application in applications {
        let path = application.path.trim();
        if path.is_empty() || path.contains([',', '\r', '\n']) {
            bail!("Application paths must be nonempty and cannot contain commas or newlines");
        }
        rules.push(Value::from(format!("PROCESS-PATH,{path},{exit_name}")));
    }
    // Native global/direct modes bypass process rules, so preserve their fallback in rule mode.
    match config
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("rule")
        .to_ascii_lowercase()
        .as_str()
    {
        "global" => rules.push("MATCH,GLOBAL".into()),
        "direct" => rules.push("MATCH,DIRECT".into()),
        "rule" => {
            if let Some(existing) = config.get("rules").and_then(Value::as_sequence) {
                rules.extend(existing.iter().cloned());
            }
        }
        mode => bail!("Unsupported proxy mode: {mode}"),
    }
    config.insert("mode".into(), "rule".into());
    config.insert("find-process-mode".into(), "always".into());
    config.insert("rules".into(), rules.into());
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn dedicated_line() -> DedicatedLineConfig {
        DedicatedLineConfig {
            enabled: Some(true),
            proxy_type: Some("socks5".into()),
            server: Some("192.0.2.1".into()),
            port: Some(1080),
            entry_node: Some("entry".into()),
            group: Some("manual".into()),
            ..DedicatedLineConfig::default()
        }
    }

    fn source() -> Result<Mapping> {
        Ok(serde_yaml_ng::from_str(
            "proxies:\n  - {name: entry, type: socks5, server: 192.0.2.2, port: 1080}\nproxy-groups:\n  - {name: manual, type: select, proxies: [entry]}\nrules: ['MATCH,manual']\n",
        )?)
    }

    #[test]
    fn preserves_subscription_and_rebuilds_the_same_chain() -> Result<()> {
        let original = source()?;
        let config = apply_config(original.clone(), &dedicated_line())?;
        let rebuilt = apply_config(original.clone(), &dedicated_line())?;
        assert_eq!(config, rebuilt);
        assert_eq!(config["rules"], original["rules"]);
        assert_eq!(config["proxies"][0], original["proxies"][0]);
        assert_eq!(config["proxies"][1]["dialer-proxy"].as_str(), Some("entry"));
        assert_eq!(
            config["proxy-groups"][0]["proxies"][1].as_str(),
            Some(DEFAULT_EXIT_NAME)
        );
        let disabled = DedicatedLineConfig {
            enabled: Some(false),
            ..dedicated_line()
        };
        assert_eq!(apply_config(original.clone(), &disabled)?, original);
        Ok(())
    }

    #[test]
    fn rejects_name_collisions_and_self_referencing_entries() -> Result<()> {
        let collision = DedicatedLineConfig {
            name: Some("manual".into()),
            ..dedicated_line()
        };
        assert!(apply_config(source()?, &collision).is_err());
        let cycle = DedicatedLineConfig {
            entry_node: Some("manual".into()),
            ..dedicated_line()
        };
        assert!(apply_config(source()?, &cycle).is_err());
        Ok(())
    }

    #[test]
    fn application_routing_preserves_each_modes_unselected_traffic() -> Result<()> {
        use crate::config::{DedicatedLineApplication, DedicatedLineScope};
        let line = DedicatedLineConfig {
            scope: Some(DedicatedLineScope::Applications),
            applications: Some(vec![DedicatedLineApplication {
                name: "Bookmap".into(),
                path: r"C:\Bookmap\jre\bin\javaw.exe".into(),
            }]),
            ..dedicated_line()
        };
        for mode in ["rule", "global", "direct"] {
            let mut original = source()?;
            original.insert("mode".into(), mode.into());
            let config = apply_config(original.clone(), &line)?;
            assert_eq!(config["mode"], Value::from("rule"));
            assert_eq!(config["find-process-mode"], Value::from("always"));
            assert_eq!(
                config["rules"][0],
                Value::from(r"PROCESS-PATH,C:\Bookmap\jre\bin\javaw.exe,专线出口")
            );
            let fallback = match mode {
                "global" => "MATCH,GLOBAL",
                "direct" => "MATCH,DIRECT",
                _ => "MATCH,manual",
            };
            assert_eq!(config["rules"][1], Value::from(fallback));
            assert_eq!(config["proxy-groups"], original["proxy-groups"]);
            assert_eq!(config["proxies"][1]["dialer-proxy"], Value::from("entry"));
        }
        assert_eq!(
            apply_config(
                source()?,
                &DedicatedLineConfig {
                    enabled: Some(false),
                    ..line
                }
            )?,
            source()?
        );
        Ok(())
    }

    #[test]
    fn application_routing_requires_a_nonempty_safe_application_list() -> Result<()> {
        use crate::config::{DedicatedLineApplication, DedicatedLineScope};
        let mut line = DedicatedLineConfig {
            scope: Some(DedicatedLineScope::Applications),
            ..dedicated_line()
        };
        assert!(apply_config(source()?, &line).is_err());
        line.applications = Some(vec![DedicatedLineApplication {
            name: "invalid".into(),
            path: "C:\\app,another.exe".into(),
        }]);
        assert!(apply_config(source()?, &line).is_err());
        Ok(())
    }
}
