# Dedicated-line fork upgrade

Baseline: upstream stable `v2.5.8`, commit `4337bd85758d54d7b9044b2da3c9ac1176eae1f3`, released 2026-10-09; verified against GitHub on 2026-10-17. The original custom branch is preserved as `codex/backup-dedicated-line-20261017` at `b4bf49620825cc9224e557cd857a52926a41e3f4`.

The fork retains SOCKS5/HTTP dedicated exits and the entry-to-exit `dialer-proxy` chain. Its navigation now uses upstream navigation metadata, configuration changes use the upstream effects registry, and the page reads the current proxy-view model through the shared mutation layer. Rule mode lets the user choose the affected selector. Nested selectors are resolved before connecting to avoid an entry that loops through the exit's own group.

Startup restores the dedicated exit selection while it remains enabled, including configurations saved by the previous version. Disconnection regenerates the subscription-derived configuration without the injected exit and restores the recorded entry. Subscription source files are not rewritten. A conflicting exit name is rejected rather than replacing a subscription node.

## Apple Silicon build

M5 uses the existing Apple Silicon target, `aarch64-apple-darwin`. The development workflow builds this target, runs the dedicated-line regression tests, validates each bundled Mach-O architecture and signature, and executes both bundled Mihomo cores. Its artifact is an ARM64 DMG. These checks do not establish that the GUI was tested on physical M5 hardware.

This fork uses explicit ad-hoc signing (`signingIdentity: "-"`). It has no Developer ID distribution identity or notarization in the development workflow. Therefore a browser-downloaded artifact may still be blocked by Gatekeeper even when architecture and signature integrity checks pass.

For the user's own trusted build, fully quit the old Clash Verge from its tray menu before replacing it, then copy the app from the DMG into Applications. Upstream's [macOS FAQ](https://www.clashverge.dev/faq/macos.html) also identifies replacing a running installation as a possible source of package damage. If macOS blocks the trusted app, first use System Settings → Privacy & Security → Open Anyway. If the app specifically reports “damaged,” verify its integrity and quarantine status in Terminal:

```sh
file "/Applications/Clash Verge.app/Contents/MacOS/clash-verge"
codesign --verify --deep --strict --verbose=2 "/Applications/Clash Verge.app"
spctl --assess --type execute -vv "/Applications/Clash Verge.app"
xattr -p com.apple.quarantine "/Applications/Clash Verge.app"
```

For this personally built, verified app only, remove its download quarantine attribute if needed:

```sh
xattr -dr com.apple.quarantine "/Applications/Clash Verge.app"
```

Do not change system-wide Gatekeeper settings. To distribute a download that passes Gatekeeper without a local exception, use a Developer ID Application certificate and notarize it with Apple. The previous launch issue remains under investigation in [macos-app-damaged.md](../debug-notes/macos-app-damaged.md).

After installing on the M5, the remaining hardware-dependent acceptance is launching the GUI, connecting through the user's actual entry and dedicated server, checking the egress IP, restarting to confirm the selected exit, and disconnecting to restore the entry. No real subscription or dedicated-server credentials are stored in this report.

## Validation on 2026-10-17

TypeScript type checking, the production frontend build, full frontend ESLint, Biome formatting and the architecture gates passed. Vitest passed all 47 tests across 12 files. On Windows, `cargo check --locked -p clash-verge --tests --features clippy`, `cargo fmt --all -- --check`, and `cargo clippy --offline --locked -p clash-verge --tests --features clippy -- -D warnings` passed with Rust 1.99.0. `cargo test --offline --locked -p clash-verge --features clippy --lib dedicated_line` passed all three dedicated-line backend tests. Knip reports the pre-existing unused `readLegacyTestUrls` export in `src/services/proxy-test-url.ts`; that file is unchanged from upstream `v2.5.8`.

The local build assets were refreshed successfully with `prebuild x86_64-pc-windows-msvc --force`. Both Mihomo `v1.19.32` and `alpha-94b13ae` accepted SOCKS5 and HTTP exit configurations containing `dialer-proxy: entry`, using their actual `-t` configuration checker. These checks do not connect to a real dedicated server.

The [macOS build](https://github.com/dyglcc/clash-verge-rev/actions/runs/39041740672) used source commit `2555cbfda3952e818a2adddfc90924bd117369d6`. Its production build, final-DMG ARM64/signature verification, bundled-core startup checks and artifact upload all passed. The native dedicated-line tests and all 47 frontend tests also passed on the Apple Silicon runner. Download the DMG and checksum together from [Release dedicated-line-v2.5.8.1](https://github.com/dyglcc/clash-verge-rev/releases/tag/dedicated-line-v2.5.8.1), published on 2026-10-18 for continued access. The original [macos-aarch64 Actions artifact](https://github.com/dyglcc/clash-verge-rev/actions/runs/39041740672/artifacts/12104473455) expires on 2027-01-15. The release preserves the verified deploy-test build of this fork, with the source revision in its installer version string. GitHub normalizes the space in the uploaded asset name to a period; the release checksum file uses that normalized filename, while the DMG bytes are unchanged.

The attachments were transferred by [run 39126857221](https://github.com/dyglcc/clash-verge-rev/actions/runs/39126857221), whose upload job checked the expected SHA-256 before transfer. GitHub's stored installer digest also matched that value before publication. To transfer a future verified build, dispatch Development Test with `publish_run_id`, `publish_release_tag` and `publish_expected_sha256`; the destination must be an existing dedicated-line draft release. The job uploads its verified macOS artifact and checksum for subsequent publication.

The final package contains seven verified ARM64 Mach-O executables, including the main app, frontend-contract helper, both Mihomo cores and three service executables. Both packaged cores (`v1.19.32` and `alpha-94b13ae`) executed successfully. The downloaded DMG was independently hashed on Windows and matched both the CI log and its `.sha256` file:

```text
Clash Verge_2.5.8+deploytest.1017.2555cbf_aarch64.dmg
80,611,979 bytes
SHA-256: e82432857c8bdc3465a9e68e5845468dea7b7e57b9cf56b1d79f3c089cb05770
```

On the Mac, compare `shasum -a 256` for the downloaded DMG with this value before installation.

The inherited updater endpoints still point at official upstream releases. Installing a future official update would replace the custom dedicated-line build; keep using this fork's builds while this feature is needed.

## Application-specific routing added on 2026-10-20

Choose "仅指定应用" in the dedicated-line page, add the actual executable from the Windows running-process list or the file browser, and enable TUN. Configure the normal entry and dedicated exit, then connect the dedicated line. Saving changes while connected applies the updated list. Restart the selected application so its existing connections are rebuilt; the operating system and Clash do not need to restart. Disabling application routing also requires restarting that application's existing dedicated connections to end them. Editing the application list or disabling application-only routing does not forcibly close other applications' connections. Switching between the old all-traffic scope and application scope closes existing connections so traffic from the old scope cannot keep using its previous route.

Previously saved configurations retain the original "全部流量" scope until the user changes it. New configurations default to application scope. Applications are identified by full executable path, independently of PID, so the selection survives restarts. For Bookmap, select the executable that actually owns its network connections, often its bundled `javaw.exe`; selecting only a launcher does not select a separate Java child executable. Multiple applications sharing the exact same executable path cannot be distinguished by window title or Java arguments. Paths containing commas or newlines are rejected by the rule editor.

Selected applications always use the saved entry-to-exit chain. Unselected traffic retains the user's chosen mode: the existing subscription rules in rule mode, the normal GLOBAL selector in global mode, and DIRECT in direct mode. Native Mihomo global/direct modes skip process rules, so this feature generates a rule-mode runtime with the appropriate fallback, while the frontend, saved configuration and tray retain the user's logical mode. Switching modes regenerates the configuration through the shared transaction pipeline. External dashboards should not override the core's runtime mode directly while application routing is active.

The dedicated-line verification button uses a separate loopback listener pinned to the exit. Its result verifies the chain, independently of which applications are selected. Confirm a particular application's matching process and chain in the connections view after restarting it.

On Windows, actual Mihomo `v1.19.32` was tested with two distinct client executables and isolated local proxy servers. The selected executable was restarted between cases, and the unselected client used a different executable path. No system proxy or TUN settings were changed by this test.

| Chosen mode | Selected executable | Unselected executable | Verification request |
| --- | --- | --- | --- |
| Global | Entry then dedicated exit | Normal GLOBAL proxy | Entry then dedicated exit |
| Rule | Entry then dedicated exit | Original IP-CIDR rule, DIRECT | Entry then dedicated exit |
| Direct | Entry then dedicated exit | DIRECT | Entry then dedicated exit |

The mock servers observed six entry connections, six dedicated-exit connections, one normal global-proxy connection and two direct target connections. All cases passed, including a selected executable path containing Chinese characters and spaces. This establishes process matching and two-hop routing through the real core; it does not establish Bookmap's executable choice or connectivity to the user's real dedicated server.

UDP was tested separately with a real SOCKS5 UDP association. Mihomo skips matched adapters that do not support UDP; without terminal rejection rules, an HTTP dedicated exit and an HTTP GLOBAL selector could fall through to DIRECT. This behavior was reproduced, then corrected with per-application rejection guards and a terminal global-mode rejection. The selected executable's UDP stayed blocked in all three modes; unselected UDP stayed blocked with an HTTP global proxy and followed the original direct routing in rule/direct modes. Only the two expected unselected direct UDP packets reached the local UDP server. Use UDP-capable SOCKS5 entry and exit servers when the selected application needs UDP.

Frontend type checking, the production build, linting and architecture checks passed; Vitest passed all 48 tests. All six dedicated-line backend tests passed, including the Windows process picker finding the test executable. Strict Clippy passed both the scoped check and the repository's all-target/all-feature pre-push check. The pre-push Knip check still reports only the existing, unchanged upstream `readLegacyTestUrls` export described above.

The [2026-10-20 installer build](https://github.com/dyglcc/clash-verge-rev/actions/runs/39410746629) uses source `4e9923518c05a82a82dc29d35959f54a59a87f26`. On the Apple Silicon runner, all 48 frontend tests and five platform-applicable dedicated-line backend tests passed. The final DMG passed verification of all seven ARM64 Mach-O executables, individual and outer app signatures, and startup of both packaged Mihomo cores. Its independent Windows download hash matched the CI checksum. [Transfer run 39413708116](https://github.com/dyglcc/clash-verge-rev/actions/runs/39413708116) verified the expected hash before attaching the DMG and checksum to the new release draft; GitHub's stored asset digest matched too.

```text
Clash.Verge_2.5.8+deploytest.1020.4e99235_aarch64.dmg
80,631,618 bytes
SHA-256: b59053761499659c613b8c541caba9c69f4bcf0c4e73da47f54fd8e0c2f511dd
```

The Windows x64 NSIS build and checksum generation also passed. The installer downloaded on Windows matched the CI checksum and its accompanying checksum file. [Transfer run 39414345968](https://github.com/dyglcc/clash-verge-rev/actions/runs/39414345968) verified the expected hash before attaching the installer and checksum to the same release draft. GitHub's stored installer digest and both uploaded checksum-file contents matched their expected values before publication.

```text
Clash.Verge_2.5.8+deploytest.1020.4e99235_x64-setup.exe
59,873,233 bytes
SHA-256: f3e5af9b4a4e2ba6279587cba2ccc6bcb7b995e6ac4e75670a0cebe82ef45af6
```

Both installers and checksum files are available in [Release dedicated-line-v2.5.8.2](https://github.com/dyglcc/clash-verge-rev/releases/tag/dedicated-line-v2.5.8.2), published on 2026-10-20 as a custom-fork prerelease. Its tag is pinned to the verified source above. The complete build and both transfer jobs passed. Physical M5 GUI startup and the user's real Bookmap/server combination remain hardware- and environment-dependent acceptance checks. Release `dedicated-line-v2.5.8.1` predates this application-list feature.

## Domain-first routing added on 2026-10-20

The selective scope is now labeled "指定域名与应用". Enter one bare DNS name per line: `example.com` matches that name and its subdomains, including `login.example.com`. The domain rules apply to every process, so a login page opened in Chrome uses the dedicated chain without putting all of Chrome on the application list. Applications remain an optional fallback for their other destinations and direct IP connections. Requests matching neither list keep the selected global, rule or direct policy.

Domain matching precedes application matching. Each dedicated rule retains its terminal rejection guard so unsupported UDP cannot fall through to an ordinary route. Root domains cover their own subdomains, not unrelated OAuth, identity-provider or CDN domains; add those names separately when required. Names are trimmed, lowercased and deduplicated, with one trailing DNS dot accepted. URLs, paths, ports, wildcards, IP addresses and invalid DNS labels are rejected; internationalized names can be entered in their ASCII Punycode form.

The existing `applications` scope value is preserved for saved configuration compatibility, with an optional `domains` list added to the dedicated-line configuration. Existing application-only and all-traffic configurations keep their behavior. Selective routing requires at least one domain or application. Domain-only routing can use a browser's system proxy without TUN; process fallback still requires TUN. Domain rules require the core to know the request's hostname, as with existing subscription domain rules. Neither this feature nor the application fallback discovers unrelated login domains automatically.

After saving, restart the target application and the browser used for login so existing HTTP connections are rebuilt; refreshing a page can reuse an old pooled connection. Application routing uses the full executable path and does not identify browser tabs, profiles or login sessions. No live user settings or applications were changed during development of this update.

Local Windows validation passed all 50 frontend tests and eight dedicated-line backend tests, TypeScript checking, the production frontend build, changed-file linting and formatting, and the architecture gates. The isolated real-core test exercised 36 HTTP requests and 24 SOCKS5 UDP cases with both combined and domain-only configurations in global, rule and direct modes. A separate browser-like executable reached the dedicated chain for the apex and login subdomain; `notexample.test` did not match `example.test`. The selected application still used its process fallback for unrelated destinations, while matching domain requests selected the domain rule first. The servers observed 21 entry connections, 21 exit connections, seven normal GLOBAL connections and eight direct HTTP connections. Only the six expected unselected direct UDP packets reached the target; matched HTTP-exit UDP stayed blocked. These results verify rule semantics and routing in the actual bundled Mihomo, without performing a real third-party OAuth login.

Strict workspace Clippy with all targets and features passed. Knip still reports only the pre-existing upstream `readLegacyTestUrls` export; no dependency or lock files were changed for domain routing.

The [Windows x64 build](https://github.com/dyglcc/clash-verge-rev/actions/runs/39438448264/job/118681623885) passed using source `1db4d510052c18843859a50e9a51bcd170061e13`. The downloaded NSIS installer matched its CI checksum and local checksum file. [Transfer run 39443807966](https://github.com/dyglcc/clash-verge-rev/actions/runs/39443807966) checked the expected hash before uploading it and a checksum file to the release draft. GitHub's stored installer digest and the uploaded checksum contents matched before publication.

```text
Clash.Verge_2.5.8+deploytest.1020.1db4d51_x64-setup.exe
59,875,175 bytes
SHA-256: 6715e42751a3268211d727bf2ffdec123aff13cf5253e59b5ea4e77757f510be
```

The Windows installer and checksum are available in [Release dedicated-line-v2.5.8.3](https://github.com/dyglcc/clash-verge-rev/releases/tag/dedicated-line-v2.5.8.3), published on 2026-10-20 as a custom-fork prerelease with its tag pinned to that source. Installation and real Bookmap/browser login testing are left to the user as requested.

There is no Mac installer for this domain feature in that release. The initial [Mac job](https://github.com/dyglcc/clash-verge-rev/actions/runs/39438448264/job/118681624318) and separate [retry](https://github.com/dyglcc/clash-verge-rev/actions/runs/39440908255/job/118690169808) were both cancelled by GitHub before acquiring a runner. Their annotations report hosted macOS ARM64 capacity constraints; neither job compiled or validated the update. The earlier Mac installer in `dedicated-line-v2.5.8.2` contains application routing only.
