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

Choose "仅指定应用" in the dedicated-line page, add the actual executable from the Windows running-process list or the file browser, and enable TUN. Configure the normal entry and dedicated exit, then connect the dedicated line. Saving changes while connected applies the updated list. Restart the selected application so its existing connections are rebuilt; the operating system and Clash do not need to restart. Disabling application routing also requires restarting that application's existing dedicated connections to end them. Other applications' connections are not forcibly closed by these operations.

Previously saved configurations retain the original "全部流量" scope until the user changes it. New configurations default to application scope. Applications are identified by full executable path, independently of PID, so the selection survives restarts. For Bookmap, select the executable that actually owns its network connections, often its bundled `javaw.exe`; selecting only a launcher does not select a separate Java child executable. Multiple applications sharing the exact same executable path cannot be distinguished by window title or Java arguments. Paths containing commas or newlines are rejected by the rule editor.

Selected applications always use the saved entry-to-exit chain. Unselected traffic retains the user's chosen mode: the existing subscription rules in rule mode, the normal GLOBAL selector in global mode, and DIRECT in direct mode. Native Mihomo global/direct modes skip process rules, so this feature generates a rule-mode runtime with the appropriate fallback, while the frontend, saved configuration and tray retain the user's logical mode. Switching modes regenerates the configuration through the shared transaction pipeline. External dashboards should not override the core's runtime mode directly while application routing is active.

The dedicated-line verification button uses a separate loopback listener pinned to the exit. Its result verifies the chain, independently of which applications are selected. Confirm a particular application's matching process and chain in the connections view after restarting it.

On Windows, actual Mihomo `v1.19.32` was tested with two distinct client executables and isolated local proxy servers. The selected executable was restarted between cases, and the unselected client used a different executable path. No system proxy or TUN settings were changed by this test.

| Chosen mode | Selected executable | Unselected executable | Verification request |
| --- | --- | --- | --- |
| Global | Entry then dedicated exit | Normal GLOBAL proxy | Entry then dedicated exit |
| Rule | Entry then dedicated exit | Original IP-CIDR rule, DIRECT | Entry then dedicated exit |
| Direct | Entry then dedicated exit | DIRECT | Entry then dedicated exit |

The mock servers observed six entry connections, six dedicated-exit connections, one normal global-proxy connection and two direct target connections. All cases passed. This establishes process matching and two-hop routing through the real core; it does not establish Bookmap's executable choice or connectivity to the user's real dedicated server.

Frontend type checking, the production build, linting and architecture checks passed; Vitest passed all 48 tests. All six dedicated-line backend tests passed, including the Windows process picker finding the test executable. Strict Clippy passed both the scoped check and the repository's all-target/all-feature pre-push check. The pre-push Knip check still reports only the existing, unchanged upstream `readLegacyTestUrls` export described above.

Installer build results will be recorded after the new Windows and macOS ARM64 builds finish. Release `dedicated-line-v2.5.8.1` predates this application-list feature.
