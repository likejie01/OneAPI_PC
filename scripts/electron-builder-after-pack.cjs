const fs = require('node:fs')
const path = require('node:path')
const { rcedit } = require('rcedit')

module.exports = async (context) => {
  if (context.electronPlatformName !== 'win32') {
    return
  }

  const executableName = `${context.packager.appInfo.productFilename}.exe`
  const executablePath = path.join(context.appOutDir, executableName)
  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico')

  if (!fs.existsSync(executablePath)) {
    throw new Error(`missing executable for icon patch: ${executablePath}`)
  }

  await rcedit(executablePath, { icon: iconPath })
  console.log(`afterPack icon patched: ${path.relative(context.packager.projectDir, executablePath)}`)
}
