import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const sharedIconPath = path.resolve(projectRoot, '..', 'Icon.png')
const publicIconPath = path.join(projectRoot, 'public', 'Icon.png')
const buildDir = path.join(projectRoot, 'build')
const sourceIcon = fs.existsSync(sharedIconPath) ? sharedIconPath : publicIconPath
const iconsetDir = path.join(buildDir, 'icon.iconset')
const icnsPath = path.join(buildDir, 'icon.icns')

if (!fs.existsSync(sourceIcon)) {
  throw new Error(`icon source not found: ${sourceIcon}`)
}

if (process.platform !== 'darwin') {
  throw new Error('prepare-mac-icons.mjs must run on macOS because it uses sips and iconutil')
}

fs.mkdirSync(buildDir, { recursive: true })
fs.rmSync(iconsetDir, { recursive: true, force: true })
fs.mkdirSync(iconsetDir, { recursive: true })
fs.copyFileSync(sourceIcon, publicIconPath)
fs.copyFileSync(sourceIcon, path.join(buildDir, 'icon.png'))

const sizes = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
]

for (const [size, name] of sizes) {
  execFileSync('sips', ['-z', String(size), String(size), sourceIcon, '--out', path.join(iconsetDir, name)], {
    stdio: 'ignore',
  })
}

execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'inherit' })
fs.rmSync(iconsetDir, { recursive: true, force: true })

console.log(`prepared macOS icon from ${path.relative(projectRoot, sourceIcon)}`)
