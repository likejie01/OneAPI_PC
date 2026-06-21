import fs from 'node:fs/promises'
import path from 'node:path'

export const FILE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024
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

export async function readFilePreview(targetPath: string) {
  const resolved = path.resolve(targetPath)
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) {
    throw new Error('当前路径不是文件。')
  }
  if (stat.size > FILE_PREVIEW_MAX_BYTES) {
    throw new Error('文件超过 10MB，已阻止预览以避免客户端卡顿。')
  }

  const buffer = await fs.readFile(resolved)
  const content = buffer.toString('utf8')
  return {
    path: resolved,
    name: path.basename(resolved),
    content,
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
