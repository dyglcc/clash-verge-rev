# macOS app reported as damaged

Reported on 2026-10-17: the custom 2.5.2 dedicated-line build installs on an M5 Mac but cannot open / is reported as damaged. Exact dialog text, macOS version and the original downloaded file have not yet been supplied. This machine runs Windows, so the reported launch failure cannot be reproduced locally.

## Investigation, round 1

The ordering follows the reported launch-time symptom, the previous build configuration, and the old successful ARM64 CI run.

| Hypothesis | Verification | Evidence | Status |
| --- | --- | --- | --- |
| Gatekeeper rejects a build without Developer ID signing and notarization | Inspect the previous workflow and assess the downloaded app with `spctl --assess --type execute -vv` on the affected Mac | Commit `34340f40` deliberately removed Apple signing credentials. The latest successful fork run was `26895193285`. The fork's GitHub secret names contain only the Tauri updater key and password, with no Apple credentials. No Gatekeeper output from the M5 is available. | Missing distribution credentials confirmed; causal connection to this specific dialog pending |
| An embedded executable has an invalid or missing signature | Run `codesign --verify --deep --strict --verbose=2` and verify individual Mach-O files | Previous macOS config had `signingIdentity: null` and no post-build verification. Run `39041740672` explicitly used ad-hoc signing and passed individual executable and deep bundle verification inside the final DMG. | Rebuilt package passed; original installed package remains unverified |
| Intel-only application/core/service was packaged for Apple Silicon | Inspect every Mach-O with `lipo -archs`, and execute both bundled Mihomo cores | Run `39041740672` verified ARM64 in every bundled Mach-O and successfully executed both cores on the Apple Silicon runner. The old file's name alone cannot establish what was installed. | Rebuilt package passed; original installed package remains unverified |
| Download, extraction, or copying damaged the bundle, including replacing a running installation | Compare SHA-256 with the built artifact and verify after installation | The original M5 download and checksum are unavailable. Upstream's current macOS FAQ documents damage when an installation is replaced while still running. | Pending original artifact and installed-app checks |
| A macOS runtime crash was described as a launch/security error | Inspect Console crash reports, launch stdout/stderr and OS version | The user selected “installation completes, app will not open / reports damaged.” No crash report has been provided. | Pending affected-machine diagnostics |

Ad-hoc signing makes the bundle structurally signed; it does not supply Developer ID trust or Apple notarization. A successful Apple Silicon runner build is not an M5 hardware test.

The old job's detailed logs returned HTTP 410 on 2026-10-17, so its original `codesign` output could not be recovered. The rebuilt branch passed native compatibility tests, the production build, final-DMG signing/architecture checks and both bundled-core startup checks in [run 39041740672](https://github.com/dyglcc/clash-verge-rev/actions/runs/39041740672). These results establish the rebuilt package's structural integrity and native core compatibility, not the original dialog's root cause or a physical M5 GUI launch. Installation instructions and the artifact link are in [the upgrade report](../docs/dedicated-line-upgrade.md).

References: [Apple: Safely open apps](https://support.apple.com/102445), [Tauri: macOS code signing](https://v2.tauri.app/distribute/sign/macos/), [upstream macOS FAQ](https://www.clashverge.dev/faq/macos.html).
