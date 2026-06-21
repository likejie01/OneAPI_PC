// @ts-nocheck
import { mkdirSync, promises as fs, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { MIN_DESKTOP_CLI_NODE_MAJOR, isDesktopCliNodeVersionSupported, sanitizeCliNpmEnvironment } from '../src/lib/desktop-service.ts'

const NODEJS_MIRROR_BASE_URL = 'https://npmmirror.com/mirrors/node'

export function createCliNodeRuntimeServices(deps) {
  const { getToolchainRoot, getManagedNodeRoot, getManagedNpmPrefix, getManagedPrefixBin, getManagedNodeExecutableCandidates, getManagedNpmExecutableCandidates, firstExistingPath, resolveNpmCliScriptPath, runCommand, locateSystemExecutable, getNpmCommand, clearDirectory, flattenSingleNestedDirectory, runLoggedCommand, buildNpmInvocation } = deps

function buildNodeDownloadUrl(version: string) {
  const normalizedVersion = version.startsWith('v') ? version : `v${version}`

  if (process.platform === 'win32') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    return `${NODEJS_MIRROR_BASE_URL}/${normalizedVersion}/node-${normalizedVersion}-win-${arch}.zip`
  }

  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    return `${NODEJS_MIRROR_BASE_URL}/${normalizedVersion}/node-${normalizedVersion}-darwin-${arch}.tar.gz`
  }

  throw new Error(`当前平台暂未实现 Node.js 自动安装：${process.platform}`)
}

function buildNodeDownloadUrls(version: string) {
  const mirrorUrl = buildNodeDownloadUrl(version)
  return [
    mirrorUrl,
    mirrorUrl.replace(NODEJS_MIRROR_BASE_URL, 'https://nodejs.org/dist'),
  ]
}

async function resolveLatestLtsNodeVersion() {
  const sources = [
    `${NODEJS_MIRROR_BASE_URL}/index.json`,
    'https://nodejs.org/dist/index.json',
  ]
  let lastError = ''
  let versions: Array<{
    version?: string
    lts?: string | false
  }> = []

  for (const source of sources) {
    try {
      const response = await fetch(source)
      if (!response.ok) {
        lastError = `${source}：${response.status}`
        continue
      }
      versions = (await response.json()) as Array<{
        version?: string
        lts?: string | false
      }>
      if (versions.length > 0) {
        break
      }
    } catch (error) {
      lastError = `${source}：${error instanceof Error ? error.message : String(error)}`
    }
  }

  if (!versions.length) {
    throw new Error(`获取 Node.js 版本列表失败${lastError ? `：${lastError}` : ''}`)
  }

  const latestLts = versions.find((item) => typeof item.lts === 'string' && item.version)
  if (!latestLts?.version) {
    throw new Error('未找到可用的 Node.js LTS 版本')
  }

  return latestLts.version
}

async function installManagedNodeRuntime(
  logger: ReturnType<typeof createDeployLogger>
) {
  const version = await resolveLatestLtsNodeVersion()
  const archiveUrls = buildNodeDownloadUrls(version)
  const downloadDir = path.join(getToolchainRoot(), 'downloads')
  const archiveName = path.basename(new URL(archiveUrls[0]).pathname)
  const archivePath = path.join(downloadDir, archiveName)
  const extractRoot = getManagedNodeRoot()

  await fs.mkdir(downloadDir, { recursive: true })
  await clearDirectory(extractRoot)

  let archiveBuffer: Buffer | null = null
  let lastDownloadError = ''
  for (const archiveUrl of archiveUrls) {
    logger.info('node', 'running', `准备下载 Node.js ${version}`, archiveUrl)
    try {
      const response = await fetch(archiveUrl)
      if (!response.ok) {
        lastDownloadError = `${archiveUrl}：${response.status}`
        continue
      }
      archiveBuffer = Buffer.from(await response.arrayBuffer())
      if (archiveBuffer.length > 0) {
        break
      }
      lastDownloadError = `${archiveUrl}：下载内容为空`
    } catch (error) {
      lastDownloadError = `${archiveUrl}：${error instanceof Error ? error.message : String(error)}`
    }
  }
  if (!archiveBuffer) {
    throw new Error(`下载 Node.js 失败${lastDownloadError ? `：${lastDownloadError}` : ''}`)
  }
  await fs.writeFile(archivePath, archiveBuffer)
  logger.info('node', 'success', `Node.js 安装包下载完成`, `${archivePath}\n${archiveBuffer.length} bytes`)

  if (process.platform === 'win32') {
    const extractCommand = 'powershell.exe'
    const extractArgs = [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractRoot.replace(/'/g, "''")}' -Force`,
    ]
    const extractResult = await runLoggedCommand(logger, 'node', extractCommand, extractArgs, {
      timeoutMs: 10 * 60 * 1000,
    })
    if (extractResult.exitCode !== 0) {
      throw new Error(extractResult.stderr || extractResult.stdout || '解压 Node.js 安装包失败')
    }
    await flattenSingleNestedDirectory(extractRoot, logger)
  } else {
    const extractResult = await runLoggedCommand(
      logger,
      'node',
      'tar',
      ['-xzf', archivePath, '-C', extractRoot, '--strip-components=1'],
      {
        timeoutMs: 10 * 60 * 1000,
      }
    )
    if (extractResult.exitCode !== 0) {
      throw new Error(extractResult.stderr || extractResult.stdout || '解压 Node.js 安装包失败')
    }
  }

  const managedNodePath = await firstExistingPath(getManagedNodeExecutableCandidates())
  const managedNpmPath = await firstExistingPath(getManagedNpmExecutableCandidates())
  const managedNpmCliPath = managedNodePath ? await resolveNpmCliScriptPath(managedNodePath) : ''
  if (!managedNodePath || !managedNpmPath) {
    const extractLayout = await describeDirectoryEntries(extractRoot)
    throw new Error(`Node.js 安装完成，但未找到 node/npm 可执行文件\n${extractLayout}`)
  }

  const runtime: NodeRuntimeInfo = {
    source: 'managed',
    nodePath: managedNodePath,
    npmPath: managedNpmPath,
    npmCliPath: managedNpmCliPath,
    version,
    prefixPath: getManagedNpmPrefix(),
  }

  const nodeVersionResult = await runLoggedCommand(logger, 'node', managedNodePath, ['--version'], {
    timeoutMs: 15000,
  })
  const npmVersionResult = await runLoggedNpmCommand(logger, 'node', runtime, ['--version'], {
    timeoutMs: 15000,
  })
  if (nodeVersionResult.exitCode !== 0 || npmVersionResult.exitCode !== 0) {
    throw new Error(
      `Node.js 安装后校验失败\nnode:\n${nodeVersionResult.stderr || nodeVersionResult.stdout}\n\nnpm:\n${npmVersionResult.stderr || npmVersionResult.stdout}`
    )
  }
  const installedVersion =
    nodeVersionResult.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || version
  if (!isDesktopCliNodeVersionSupported(installedVersion)) {
    throw new Error(
      `Node.js 安装后版本过低：${installedVersion}。Codex / Claude 一键部署需要 Node.js ${MIN_DESKTOP_CLI_NODE_MAJOR}+。`
    )
  }

  return {
    ...runtime,
    version: installedVersion,
  }
}

async function ensureNodeRuntime(
  logger: ReturnType<typeof createDeployLogger>
): Promise<NodeRuntimeInfo> {
  async function verifyRuntime(runtime: NodeRuntimeInfo, label: '系统' | '内置') {
    const versionResult = await runLoggedCommand(logger, 'node', runtime.nodePath, ['--version'])
    const npmVersionResult = await runLoggedNpmCommand(logger, 'node', runtime, ['--version'])
    const version =
      versionResult.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || ''
    if (versionResult.exitCode !== 0 || npmVersionResult.exitCode !== 0) {
      logger.info(
        'node',
        'running',
        `${label} Node.js 不完整，准备使用内置 Node.js`,
        [
          versionResult.stderr || versionResult.stdout,
          npmVersionResult.stderr || npmVersionResult.stdout,
        ].filter(Boolean).join('\n')
      )
      return null
    }

    if (!isDesktopCliNodeVersionSupported(version)) {
      logger.info(
        'node',
        'running',
        `${label} Node.js ${version || '未知版本'} 版本过低，准备使用内置 Node.js`,
        `Codex / Claude 一键部署需要 Node.js ${MIN_DESKTOP_CLI_NODE_MAJOR}+。`
      )
      return null
    }

    logger.info('node', 'success', `已检测到${label} Node.js ${version || '未知版本'}`, runtime.nodePath)
    return {
      ...runtime,
      version,
    }
  }

  const systemNodePath = await locateSystemExecutable('node')
  const systemNpmPath = await locateSystemExecutable(getNpmCommand())
  if (systemNodePath && systemNpmPath) {
    const systemRuntime: NodeRuntimeInfo = {
      source: 'system',
      nodePath: systemNodePath,
      npmPath: systemNpmPath,
      npmCliPath: await resolveNpmCliScriptPath(systemNodePath),
      version: '',
      prefixPath: getManagedNpmPrefix(),
    }
    const verified = await verifyRuntime(systemRuntime, '系统')
    if (verified) {
      return verified
    }
  }

  const managedNodePath = await firstExistingPath(getManagedNodeExecutableCandidates())
  const managedNpmPath = await firstExistingPath(getManagedNpmExecutableCandidates())
  if (managedNodePath && managedNpmPath) {
    const managedRuntime: NodeRuntimeInfo = {
      source: 'managed',
      nodePath: managedNodePath,
      npmPath: managedNpmPath,
      npmCliPath: await resolveNpmCliScriptPath(managedNodePath),
      version: '',
      prefixPath: getManagedNpmPrefix(),
    }
    const verified = await verifyRuntime(managedRuntime, '内置')
    if (verified) {
      return verified
    }
  }

  logger.info('node', 'running', '当前未检测到可用 Node.js 18+，开始安装内置 Node.js')
  return installManagedNodeRuntime(logger)
}

function buildRuntimeEnv(runtime: NodeRuntimeInfo) {
  const nodeDir = path.dirname(runtime.nodePath)
  const prefixBin = getManagedPrefixBin(runtime.prefixPath)
  const pathSegments = [prefixBin, nodeDir, process.env.PATH || ''].filter(Boolean)
  const npmConfigPaths = ensureDesktopCliNpmConfigFiles()

  return {
    ...sanitizeCliNpmEnvironment(process.env, {
      registry: 'https://registry.npmmirror.com',
      prefix: runtime.prefixPath,
      cache: path.join(getToolchainRoot(), 'npm-cache'),
      userConfig: npmConfigPaths.userConfigPath,
      globalConfig: npmConfigPaths.globalConfigPath,
    }),
    PATH: pathSegments.join(process.platform === 'win32' ? ';' : ':'),
  }
}

function buildCliExecutionEnv(runtime?: NodeRuntimeInfo | null) {
  const npmConfigPaths = ensureDesktopCliNpmConfigFiles()
  if (runtime) {
    return buildRuntimeEnv(runtime)
  }

  return {
    ...sanitizeCliNpmEnvironment(process.env, {
      registry: 'https://registry.npmmirror.com',
      cache: path.join(getToolchainRoot(), 'npm-cache'),
      userConfig: npmConfigPaths.userConfigPath,
      globalConfig: npmConfigPaths.globalConfigPath,
    }),
  }
}

function ensureDesktopCliNpmConfigFiles() {
  const configDir = path.join(getToolchainRoot(), 'npm-config')
  const userConfigPath = path.join(configDir, 'user.npmrc')
  const globalConfigPath = path.join(configDir, 'global.npmrc')
  const content = [
    'registry=https://registry.npmmirror.com',
    'proxy=',
    'https-proxy=',
    'noproxy=*',
    'offline=false',
    'prefer-offline=false',
    'prefer-online=true',
  ].join('\n')

  mkdirSync(configDir, { recursive: true })
  writeFileSync(userConfigPath, content, 'utf8')
  writeFileSync(globalConfigPath, content, 'utf8')

  return {
    userConfigPath,
    globalConfigPath,
  }
}

async function readManagedNodeRuntime() {
  const nodePath = await firstExistingPath(getManagedNodeExecutableCandidates())
  const npmPath = await firstExistingPath(getManagedNpmExecutableCandidates())
  if (!nodePath || !npmPath) {
    return null
  }
  const npmCliPath = await resolveNpmCliScriptPath(nodePath)

  const versionResult = await runCommand(nodePath, ['--version'], { timeoutMs: 15000 })
  const version =
    versionResult.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || ''
  if (versionResult.exitCode !== 0 || !isDesktopCliNodeVersionSupported(version)) {
    return null
  }

  return {
    source: 'managed' as const,
    nodePath,
    npmPath,
    npmCliPath,
    version,
    prefixPath: getManagedNpmPrefix(),
  }
}

async function runLoggedNpmCommand(
  logger: ReturnType<typeof createDeployLogger>,
  step: DeployProgressPayload['step'],
  runtime: NodeRuntimeInfo,
  args: string[],
  options: {
    cwd?: string
    timeoutMs?: number
    env?: NodeJS.ProcessEnv
    stdinData?: string
  } = {}
) {
  const invocation = buildNpmInvocation(runtime, args)
  if (runtime.npmCliPath) {
    logger.info(step, 'running', '使用 node + npm-cli.js 执行 npm 命令', runtime.npmCliPath)
  }
  return runLoggedCommand(logger, step, invocation.command, invocation.args, options)
}

async function installCliPackage(
  client: CliClient,
  runtime: NodeRuntimeInfo,
  logger: ReturnType<typeof createDeployLogger>
) {
  await fs.mkdir(runtime.prefixPath, { recursive: true })
  return runLoggedNpmCommand(
    logger,
    'install',
    runtime,
    ['install', '-g', '--prefix', runtime.prefixPath, cliConfig[client].packageName],
    {
      timeoutMs: 10 * 60 * 1000,
      env: buildRuntimeEnv(runtime),
    }
  )
}

  return {
    ensureNodeRuntime,
    buildRuntimeEnv,
    buildCliExecutionEnv,
    readManagedNodeRuntime,
    runLoggedNpmCommand,
    installCliPackage,
  }
}
