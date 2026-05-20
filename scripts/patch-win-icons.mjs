import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rcedit } from 'rcedit'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const releaseDir = path.join(projectRoot, 'release')
const iconPath = path.join(projectRoot, 'build', 'icon.ico')

const targets = [
  path.join(releaseDir, 'win-unpacked', 'OneAPI PC.exe'),
]

for (const target of targets) {
  if (!fs.existsSync(target)) {
    continue
  }
  await rcedit(target, { icon: iconPath })
  console.log(`patched icon: ${path.relative(projectRoot, target)}`)
}
