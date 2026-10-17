# macOS app reported as damaged

Reported on 2026-10-17: the custom 2.5.2 dedicated-line build installs on an M5 Mac but cannot open / is reported as damaged. Exact dialog text, macOS version and the original downloaded file have not yet been supplied. This machine runs Windows, so the reported launch failure cannot be reproduced locally.

## Investigation, round 1

The ordering follows the reported launch-time symptom, the previous build configuration, and the old successful ARM64 CI run.

| Hypothesis | Verification | Evidence | Status |
| --- | --- | --- | --- |
| Gatekeeper rejects a build without Developer ID signing and notarization | Inspect the previous workflow and assess the downloaded app with `spctl --assess --type execute -vv` on the affected Mac | Commit `34340f40` deliberately removed Apple signing credentials. The latest successful fork run was `26895193285`. The fork's GitHub secret names contain only the Tauri updater key and password, with no Apple credentials. No Gatekeeper output from the M5 is available. | Missing distribution credentials confirmed; causal connection to this specific dialog pending |
| An embedded executable has an invalid or missing signature | Run `codesign --verify --deep --strict --verbose=2` and verify individual Mach-O files | Previous macOS config had `signingIdentity: null` and no post-build verification. New builds explicitly request ad-hoc signing and run `scripts/verify-macos-bundle.mjs`. | Pending macOS build results |
| Intel-only application/core/service was packaged for Apple Silicon | Inspect every Mach-O with `lipo -archs`, and execute both bundled Mihomo cores | The old successful run included `aarch64-apple-darwin`; its release contains an `aarch64.dmg`. That filename alone cannot establish the architectures inside the package actually installed. | Pending package verification |
| Download, extraction, or copying damaged the bundle | Compare SHA-256 with the built artifact and verify after installation | The original M5 download and checksum are unavailable. | Pending original artifact and installed-app checks |
| A macOS runtime crash was described as a launch/security error | Inspect Console crash reports, launch stdout/stderr and OS version | The user selected “installation completes, app will not open / reports damaged.” No crash report has been provided. | Pending affected-machine diagnostics |

Ad-hoc signing makes the bundle structurally signed; it does not supply Developer ID trust or Apple notarization. A successful Apple Silicon runner build is not an M5 hardware test.

The old job's detailed logs returned HTTP 410 on 2026-10-17, so its original `codesign` output could not be recovered. The rebuilt branch has passed its macOS native compatibility stage in run `39038471140`; bundle signing and architecture checks follow packaging.

References: [Apple: Safely open apps](https://support.apple.com/102445), [Tauri: macOS code signing](https://v2.tauri.app/distribute/sign/macos/).
