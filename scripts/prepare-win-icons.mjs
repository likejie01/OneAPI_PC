import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const sharedIconPath = path.resolve(projectRoot, '..', 'Icon.png')
const publicIconPath = path.join(projectRoot, 'public', 'Icon.png')
const buildDir = path.join(projectRoot, 'build')
const buildPngPath = path.join(buildDir, 'icon.png')
const buildIcoPath = path.join(buildDir, 'icon.ico')

const sourceIcon = fs.existsSync(sharedIconPath) ? sharedIconPath : publicIconPath

if (!fs.existsSync(sourceIcon)) {
  throw new Error(`icon source not found: ${sourceIcon}`)
}

fs.mkdirSync(buildDir, { recursive: true })
fs.copyFileSync(sourceIcon, publicIconPath)
fs.copyFileSync(sourceIcon, buildPngPath)

const icoBuffer = await pngToIco(sourceIcon)
fs.writeFileSync(buildIcoPath, icoBuffer)

console.log(`prepared Windows icon from ${path.relative(projectRoot, sourceIcon)}`)
