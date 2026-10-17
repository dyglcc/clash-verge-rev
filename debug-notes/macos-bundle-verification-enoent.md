# macOS bundle verification ENOENT

2026-10-17, workflow run `39038471140`, job `117413095134`: `Verify Apple Silicon bundle` failed with `ENOENT` while reading `target/aarch64-apple-darwin/release/bundle/macos/Clash Verge.app/Contents`. The preceding Tauri build completed successfully. This is an error in the new verification step, not evidence of the user's original M5 launch failure.

| Hypothesis | Verification | Observed evidence | Conclusion |
| --- | --- | --- | --- |
| A DMG-only build removes the temporary app | Read the bundler's final output | At 14:30:22 UTC the log explicitly says `Cleaning .../bundle/macos/Clash Verge.app`, then lists one completed DMG | Confirmed |
| The product name changed | Compare the configured name with bundling output | Both configuration and logs use `Clash Verge.app` | Excluded |
| The target directory is wrong | Compare the build output and verification path | Both use `target/aarch64-apple-darwin/release/bundle` | Excluded |
| Compilation or signing failed | Inspect the preceding step's result | `Tauri build` succeeded; the log signs the app with identity `-` and reports a 76.88 MiB DMG | Excluded as the cause of this ENOENT |
| The working directory is wrong | Compare absolute paths in the error and bundler output | Both resolve under the same checked-out workspace | Excluded |

The verifier now mounts the final DMG read-only, verifies the app inside, executes the two bundled cores and writes a SHA-256 sidecar. A small signed fixture DMG exercises this path before native compilation. The workflow retains produced DMGs and Rust caches on failure for diagnosis. The native test and app build now share an explicit target directory to avoid compiling their dependencies twice. These corrections do not change application runtime code.

Confirmed in [run 39041740672](https://github.com/dyglcc/clash-verge-rev/actions/runs/39041740672): both the signed fixture DMG and the real production DMG passed verification, and the installer/checksum artifact was uploaded successfully.
