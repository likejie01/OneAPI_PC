import fs from 'node:fs/promises'
import path from 'node:path'

export const FILE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024
export const FILE_BASE64_MAX_BYTES = 32 * 1024 * 1024
const EXTERNAL_URL_PROTOCOL_ALLOWLIST = new Set(['http:', 'https:', 'mailto:'])

export function normalizeDirectoryForAccess(targetPath: string) {
  const normalized = targetPath.trim()
  return normalized ? path.resolve(normalized) : ''
}

export async function pathExists(target: string) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export async function resolveOpenTarget(targetPath: string) {
  const normalized = targetPath.trim()
  if (!normalized) {
    return ''
  }

  if (await pathExists(normalized)) {
    const stat = await fs.stat(normalized)
    return stat.isDirectory() ? normalized : path.dirname(normalized)
  }

  const parentDirectory = path.dirname(normalized)
  if (await pathExists(parentDirectory)) {
    return parentDirectory
  }

  return ''
}

export async function resolveOpenFileTarget(targetPath: string) {
  const normalized = targetPath.trim()
  if (!normalized) {
    throw new Error('目标路径为空。')
  }

  let stat
  try {
    stat = await fs.stat(normalized)
  } catch {
    throw new Error('目标文件不存在。')
  }

  if (!stat.isFile()) {
    throw new Error('目标路径不是文件。')
  }

  return path.resolve(normalized)
}

const TEXT_PREVIEW_EXTENSIONS = new Set([
  '.bat',
  '.c',
  '.cmd',
  '.conf',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.env',
  '.go',
  '.h',
  '.hpp',
  '.htm',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsonl',
  '.jsx',
  '.kt',
  '.log',
  '.lua',
  '.mjs',
  '.md',
  '.markdown',
  '.php',
  '.ps1',
  '.py',
  '.rs',
  '.sh',
  '.sql',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
])

function isLikelyTextBuffer(buffer: Buffer) {
  if (!buffer.length) {
    return true
  }
  if (buffer.includes(0)) {
    return false
  }
  let suspiciousControlBytes = 0
  for (const byte of buffer) {
    if (byte < 7 || (byte > 13 && byte < 32)) {
      suspiciousControlBytes += 1
    }
  }
  return suspiciousControlBytes / buffer.length < 0.02
}

function assertPreviewableTextFile(resolved: string, sample: Buffer) {
  const extension = path.extname(resolved).toLowerCase()
  if (TEXT_PREVIEW_EXTENSIONS.has(extension) || isLikelyTextBuffer(sample)) {
    return
  }
  throw new Error('当前文件不支持内置预览，请使用系统工具打开。')
}

export async function readFilePreview(targetPath: string) {
  const resolved = path.resolve(targetPath)
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) {
    throw new Error('当前路径不是文件。')
  }
  if (stat.size > FILE_PREVIEW_MAX_BYTES) {
    throw new Error('文件超过 10MB，已阻止预览以避免客户端卡顿。')
  }

  const handle = await fs.open(resolved, 'r')
  try {
    const sample = Buffer.alloc(Math.min(stat.size, 4096))
    await handle.read(sample, 0, sample.length, 0)
    assertPreviewableTextFile(resolved, sample)
  } finally {
    await handle.close()
  }

  const buffer = await fs.readFile(resolved)
  const content = buffer.toString('utf8')
  return {
    path: resolved,
    name: path.basename(resolved),
    content,
  }
}

function inferMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  switch (extension) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    case '.svg':
      return 'image/svg+xml'
    case '.txt':
      return 'text/plain'
    case '.json':
      return 'application/json'
    case '.pdf':
      return 'application/pdf'
    default:
      return 'application/octet-stream'
  }
}

export async function readFileBase64(targetPath: string) {
  const resolved = path.resolve(targetPath)
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) {
    throw new Error('当前路径不是文件。')
  }
  if (stat.size > FILE_BASE64_MAX_BYTES) {
    throw new Error('文件超过 32MB，已阻止加载以避免客户端内存占用过高。')
  }

  const buffer = await fs.readFile(resolved)
  return {
    path: resolved,
    name: path.basename(resolved),
    mimeType: inferMimeType(resolved),
    size: stat.size,
    dataBase64: buffer.toString('base64'),
  }
}

export function assertAllowedExternalUrl(url: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('外部链接格式无效。')
  }
  if (!EXTERNAL_URL_PROTOCOL_ALLOWLIST.has(parsed.protocol)) {
    throw new Error(`不支持打开 ${parsed.protocol || '未知'} 协议链接。`)
  }
  return parsed.toString()
}

export function createCliAccessDirectoryResolver(getAttachmentDirectory: () => string) {
  const authorizedDirectories = new Set<string>()

  function rememberDirectory(targetPath: string) {
    const normalized = normalizeDirectoryForAccess(targetPath)
    if (normalized) {
      authorizedDirectories.add(normalized)
    }
  }

  async function rememberOpenTarget(targetPath: string) {
    const normalized = normalizeDirectoryForAccess(targetPath)
    if (!normalized) {
      return
    }
    const stat = await fs.stat(normalized).catch(() => null)
    rememberDirectory(stat?.isFile() ? path.dirname(normalized) : normalized)
  }

  function resolve(projectPath: string) {
    const projectRoot = normalizeDirectoryForAccess(projectPath)
    const directories = new Set<string>()
    if (projectRoot) {
      directories.add(projectRoot)
    }
    directories.add(getAttachmentDirectory())
    for (const directory of authorizedDirectories) {
      const normalized = normalizeDirectoryForAccess(directory)
      if (normalized) {
        directories.add(normalized)
      }
    }
    return Array.from(directories)
  }

  return {
    rememberDirectory,
    rememberOpenTarget,
    resolve,
  }
}
