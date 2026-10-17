import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [bundle, expectedArch] = process.argv.slice(2)
if (
  process.platform !== 'darwin' ||
  !bundle ||
  !['arm64', 'x86_64'].includes(expectedArch)
) {
  throw new Error(
    'Usage on macOS: node scripts/verify-macos-bundle.mjs <app bundle> <arm64|x86_64>',
  )
}

const app = path.resolve(bundle)
const machoMagic = new Set([
  'cffaedfe',
  'cefaedfe',
  'feedfacf',
  'feedface',
  'cafebabe',
  'bebafeca',
  'cafebabf',
])
const binaries = []
function inspect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      inspect(file)
    } else if (entry.isFile()) {
      const descriptor = fs.openSync(file, 'r')
      const magic = Buffer.alloc(4)
      try {
        fs.readSync(descriptor, magic, 0, 4, 0)
      } finally {
        fs.closeSync(descriptor)
      }
      if (!machoMagic.has(magic.toString('hex'))) continue
      const architectures = execFileSync('lipo', ['-archs', file], {
        encoding: 'utf8',
      }).trim()
      if (!architectures.split(/\s+/).includes(expectedArch)) {
        throw new Error(
          `Wrong architecture in ${file}: ${architectures}; expected ${expectedArch}`,
        )
      }
      execFileSync('codesign', ['--verify', '--strict', file], {
        stdio: 'inherit',
      })
      binaries.push(file)
      console.log(
        `${path.relative(app, file)}: ${architectures}, signature verified`,
      )
    }
  }
}

inspect(path.join(app, 'Contents'))
if (!binaries.some((file) => file.includes(`${path.sep}MacOS${path.sep}`))) {
  throw new Error('The app bundle contains no Mach-O executable')
}
execFileSync(
  'codesign',
  ['--verify', '--deep', '--strict', '--verbose=2', app],
  { stdio: 'inherit' },
)
for (const name of ['verge-mihomo', 'verge-mihomo-alpha']) {
  const core = binaries.find((file) => path.basename(file) === name)
  if (!core) throw new Error(`Missing bundled core: ${name}`)
  console.log(
    execFileSync(core, ['-v'], { encoding: 'utf8', timeout: 15000 }).trim(),
  )
}
for (const name of [
  'clash-verge-service',
  'clash-verge-service-install',
  'clash-verge-service-uninstall',
]) {
  if (!binaries.some((file) => path.basename(file) === name)) {
    throw new Error(`Missing bundled service executable: ${name}`)
  }
}
console.log(
  `Verified ${binaries.length} Mach-O binaries for ${expectedArch}. Physical M5 testing and Gatekeeper assessment are separate checks.`,
)
