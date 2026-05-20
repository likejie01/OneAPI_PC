import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const releaseDir = path.join(projectRoot, 'release')
const unpackedDir = path.join(releaseDir, 'win-unpacked')
const finalUnpackedDir = path.join(releaseDir, 'OneAPI_PC-1-0')
const finalZipPath = path.join(releaseDir, 'OneAPI_PC-1-0.zip')
const oldInstallerPath = path.join(releaseDir, 'OneAPI PC Setup 0.1.0.exe')
const oldPortablePath = path.join(releaseDir, 'OneAPI PC 0.1.0.exe')
const oldBlockmapPath = path.join(releaseDir, 'OneAPI PC Setup 0.1.0.exe.blockmap')
const finalInstallerPath = path.join(releaseDir, 'OneAPI_PC_Setup-1-0.exe')
const finalPortablePath = path.join(releaseDir, 'OneAPI_PC-1-0.exe')
const finalBlockmapPath = path.join(releaseDir, 'OneAPI_PC_Setup-1-0.exe.blockmap')

const removeIfExists = (targetPath) => {
  if (!fs.existsSync(targetPath)) {
    return
  }
  fs.rmSync(targetPath, { recursive: true, force: true })
}

const moveIfExists = (sourcePath, destinationPath) => {
  if (!fs.existsSync(sourcePath)) {
    return
  }
  removeIfExists(destinationPath)
  fs.renameSync(sourcePath, destinationPath)
}

moveIfExists(oldInstallerPath, finalInstallerPath)
moveIfExists(oldPortablePath, finalPortablePath)
moveIfExists(oldBlockmapPath, finalBlockmapPath)

if (!fs.existsSync(unpackedDir)) {
  throw new Error(`missing unpacked directory: ${unpackedDir}`)
}

removeIfExists(finalUnpackedDir)
fs.cpSync(unpackedDir, finalUnpackedDir, { recursive: true })

removeIfExists(finalZipPath)
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${finalUnpackedDir}\\*' -DestinationPath '${finalZipPath}'`,
  ],
  {
    stdio: 'inherit',
  },
)

console.log(`finalized Windows release in ${path.relative(projectRoot, releaseDir)}`)
