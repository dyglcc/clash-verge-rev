# Dedicated-line fork upgrade

Baseline: upstream stable `v2.5.8`, commit `4337bd85758d54d7b9044b2da3c9ac1176eae1f3`, released 2026-10-09; verified against GitHub on 2026-10-17. The original custom branch is preserved as `codex/backup-dedicated-line-20261017` at `b4bf49620825cc9224e557cd857a52926a41e3f4`.

The fork retains SOCKS5/HTTP dedicated exits and the entry-to-exit `dialer-proxy` chain. Its navigation now uses upstream navigation metadata, configuration changes use the upstream effects registry, and the page reads the current proxy-view model through the shared mutation layer. Rule mode lets the user choose the affected selector. Nested selectors are resolved before connecting to avoid an entry that loops through the exit's own group.

Startup restores the dedicated exit selection while it remains enabled, including configurations saved by the previous version. Disconnection regenerates the subscription-derived configuration without the injected exit and restores the recorded entry. Subscription source files are not rewritten. A conflicting exit name is rejected rather than replacing a subscription node.

## Apple Silicon build

M5 uses the existing Apple Silicon target, `aarch64-apple-darwin`. The development workflow builds this target, runs the dedicated-line regression tests, validates each bundled Mach-O architecture and signature, and executes both bundled Mihomo cores. Its artifact is an ARM64 DMG. These checks do not establish that the GUI was tested on physical M5 hardware.

This fork uses explicit ad-hoc signing (`signingIdentity: "-"`). It has no Developer ID distribution identity or notarization in the development workflow. Therefore a browser-downloaded artifact may still be blocked by Gatekeeper even when architecture and signature integrity checks pass.

For the user's own trusted build, copy the app from the DMG into Applications. If macOS blocks it, first use System Settings → Privacy & Security → Open Anyway. If the app specifically reports “damaged,” verify its integrity and quarantine status in Terminal:

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

TypeScript type checking, the production frontend build, full frontend ESLint, Biome formatting and the architecture gates passed. Vitest passed all 47 tests across 12 files. On Windows, `cargo check --locked -p clash-verge --tests --features clippy`, `cargo fmt --all -- --check`, and `cargo clippy --offline --locked -p clash-verge --tests --features clippy -- -D warnings` passed with Rust 1.99.0. `cargo test --offline --locked -p clash-verge --features clippy --lib dedicated_line` passed all three dedicated-line backend tests. Knip reports the pre-existing unused `readLegacyTestUrls` export in `src/services/proxy-test-url.ts`; that file is unchanged from upstream `v2.5.8`. macOS bundle results will be recorded after the build completes.

The inherited updater endpoints still point at official upstream releases. Installing a future official update would replace the custom dedicated-line build; keep using this fork's builds while this feature is needed.
