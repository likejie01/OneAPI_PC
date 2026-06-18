import fs from 'node:fs'
import crypto from 'node:crypto'
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
const finalLatestYamlPath = path.join(releaseDir, 'latest.yml')
const packageJsonPath = path.join(projectRoot, 'package.json')

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

const readPackageVersion = () => {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const version = typeof packageJson.version === 'string' ? packageJson.version.trim() : ''
  if (!version) {
    throw new Error(`missing version in ${packageJsonPath}`)
  }
  return version
}

const calculateSha512 = (targetPath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512')
    const stream = fs.createReadStream(targetPath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('base64')))
  })

const writeLatestYaml = async () => {
  if (!fs.existsSync(finalInstallerPath)) {
    throw new Error(`missing installer artifact: ${finalInstallerPath}`)
  }

  const version = readPackageVersion()
  const sha512 = await calculateSha512(finalInstallerPath)
  const stat = fs.statSync(finalInstallerPath)
  const installerFileName = path.basename(finalInstallerPath)
  const yaml = [
    `version: ${version}`,
    'files:',
    `  - url: ${installerFileName}`,
    `    sha512: ${sha512}`,
    `    size: ${stat.size}`,
    `path: ${installerFileName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${stat.mtime.toISOString()}'`,
    '',
  ].join('\n')

  fs.writeFileSync(finalLatestYamlPath, yaml, 'utf8')
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

await writeLatestYaml()

console.log(`finalized Windows release in ${path.relative(projectRoot, releaseDir)}`)
