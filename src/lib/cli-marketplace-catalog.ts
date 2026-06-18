import type { CliClient, CliExtensionCatalogSource, CliExtensionEntry } from '../shared/desktop'

export type BundledCatalogChildEntry = {
  name: string
  description: string
  relativePath: string
}

export type BundledCatalogPluginEntry = {
  name: string
  displayName?: string
  description: string
  official?: boolean
  subdir: string
  source?: string | Record<string, unknown>
  skills?: BundledCatalogChildEntry[]
  commands?: BundledCatalogChildEntry[]
}

export type BundledPluginMarketplaceCatalog = {
  name: string
  repoUrl: string
  ref?: string
  sha?: string
  plugins: BundledCatalogPluginEntry[]
}

export type BundledCodexCuratedSkillCatalogEntry = {
  id: string
  name: string
  description: string
  repoPath: string
}

export type BundledCodexCuratedSkillCatalog = {
  repoUrl: string
  ref?: string
  sha?: string
  skills: BundledCodexCuratedSkillCatalogEntry[]
}

function normalizeName(value: string) {
  return value.trim().toLowerCase()
}

function buildInstallKey(pluginName: string, marketplaceName: string) {
  return `${pluginName}@${marketplaceName}`
}

function normalizeSourceText(value: string) {
  return value.trim().replace(/\\/g, '/').replace(/\.git$/i, '').toLowerCase()
}

function readRawSourceString(source: string | Record<string, unknown> | undefined, key: string) {
  return source && typeof source === 'object' && typeof source[key] === 'string'
    ? (source[key] as string).trim()
    : ''
}

function buildPluginSourceIdentity(marketplace: BundledPluginMarketplaceCatalog, plugin: BundledCatalogPluginEntry) {
  const rawSource = plugin.source
  if (rawSource && typeof rawSource === 'object') {
    const repo = readRawSourceString(rawSource, 'url') || readRawSourceString(rawSource, 'repo')
    const sourcePath = readRawSourceString(rawSource, 'path') || plugin.subdir
    if (repo) {
      return [
        normalizeSourceText(repo),
        normalizeSubdir(sourcePath).toLowerCase(),
      ].filter(Boolean).join('#')
    }
  }

  if (typeof rawSource === 'string' && rawSource.trim()) {
    return [
      normalizeSourceText(marketplace.repoUrl),
      normalizeSubdir(rawSource).toLowerCase(),
    ].join('#')
  }

  return [
    normalizeSourceText(marketplace.repoUrl),
    normalizeSubdir(plugin.subdir).toLowerCase(),
  ].join('#')
}

function isPluginInstalled(plugin: BundledCatalogPluginEntry, marketplaceName: string, installedPluginKeys: Set<string>) {
  return installedPluginKeys.has(buildInstallKey(plugin.name, marketplaceName))
}

function compareCatalogPluginCandidate(
  left: BundledCatalogPluginEntry,
  right: BundledCatalogPluginEntry,
  marketplaceName: string,
  installedPluginKeys: Set<string>
) {
  const leftInstalled = isPluginInstalled(left, marketplaceName, installedPluginKeys) ? 1 : 0
  const rightInstalled = isPluginInstalled(right, marketplaceName, installedPluginKeys) ? 1 : 0
  if (leftInstalled !== rightInstalled) {
    return rightInstalled - leftInstalled
  }

  const leftOfficial = left.official !== false ? 1 : 0
  const rightOfficial = right.official !== false ? 1 : 0
  if (leftOfficial !== rightOfficial) {
    return rightOfficial - leftOfficial
  }

  const leftPinned = left.source && typeof left.source === 'object' && readRawSourceString(left.source, 'sha') ? 1 : 0
  const rightPinned = right.source && typeof right.source === 'object' && readRawSourceString(right.source, 'sha') ? 1 : 0
  if (leftPinned !== rightPinned) {
    return rightPinned - leftPinned
  }

  const leftNameLength = (left.displayName?.trim() || left.name).length
  const rightNameLength = (right.displayName?.trim() || right.name).length
  return rightNameLength - leftNameLength
}

function dedupeMarketplacePlugins(
  marketplace: BundledPluginMarketplaceCatalog,
  installedPluginKeys: Set<string>
) {
  const bySource = new Map<string, BundledCatalogPluginEntry>()
  for (const plugin of marketplace.plugins) {
    const identity = buildPluginSourceIdentity(marketplace, plugin)
    const existing = bySource.get(identity)
    if (!existing || compareCatalogPluginCandidate(existing, plugin, marketplace.name, installedPluginKeys) > 0) {
      bySource.set(identity, plugin)
    }
  }
  return [...bySource.values()]
}

function buildCatalogPath(parts: string[]) {
  return `catalog://${parts.map((part) => part.trim().replace(/\\/g, '/')).join('/')}`
}

function buildCatalogEntryId(client: CliClient, kind: CliExtensionEntry['kind'], name: string, targetPath: string) {
  return `${client}:${kind}:${name.trim().toLowerCase()}:${targetPath.trim().toLowerCase()}`
}

function normalizeSubdir(value: string) {
  return value.trim().replace(/^\.\/+/, '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function createCatalogSource(
  marketplace: Pick<BundledPluginMarketplaceCatalog, 'repoUrl' | 'ref' | 'sha'>,
  plugin: Pick<BundledCatalogPluginEntry, 'subdir' | 'source'>
): CliExtensionCatalogSource {
  return {
    repoUrl: marketplace.repoUrl,
    ref: marketplace.ref,
    sha: marketplace.sha,
    subdir: normalizeSubdir(plugin.subdir),
    rawSource: plugin.source,
  }
}

export function buildCodexCuratedSkillInstallKey(name: string) {
  return `codex-curated-skill:${normalizeName(name)}`
}

export function buildBundledCodexCuratedSkillEntries(
  catalog: BundledCodexCuratedSkillCatalog,
  installedSkillNames: Set<string>
) {
  return catalog.skills
    .filter((item) => !installedSkillNames.has(normalizeName(item.name)))
    .map((item) => {
      const subdir = normalizeSubdir(item.repoPath)
      const syntheticPath = buildCatalogPath(['codex', 'skill', subdir])
      return {
        id: buildCatalogEntryId('codex', 'skill', item.name, syntheticPath),
        client: 'codex',
        kind: 'skill',
        name: item.name,
        description: item.description,
        path: syntheticPath,
        source: '官方技能',
        installed: false,
        official: true,
        installable: true,
        installKey: buildCodexCuratedSkillInstallKey(item.name),
        catalogSource: {
          repoUrl: catalog.repoUrl,
          ref: catalog.ref,
          sha: catalog.sha,
          subdir,
        },
      } satisfies CliExtensionEntry
    })
}

export function buildBundledMarketplaceEntries(
  client: CliClient,
  marketplace: BundledPluginMarketplaceCatalog,
  installedPluginKeys: Set<string>
) {
  const entries: CliExtensionEntry[] = []

  for (const plugin of dedupeMarketplacePlugins(marketplace, installedPluginKeys)) {
    const installKey = buildInstallKey(plugin.name, marketplace.name)
    const installed = installedPluginKeys.has(installKey)
    const pluginPath = buildCatalogPath([client, 'plugin', marketplace.name, normalizeSubdir(plugin.subdir)])
    const pluginId = buildCatalogEntryId(client, 'plugin', plugin.name, installKey)
    const pluginDisplayName = plugin.displayName?.trim() || plugin.name
    const catalogSource = createCatalogSource(marketplace, plugin)

    entries.push({
      id: pluginId,
      client,
      kind: 'plugin',
      name: pluginDisplayName,
      description: plugin.description,
      path: pluginPath,
      source: marketplace.name,
      marketplace: marketplace.name,
      installed,
      official: plugin.official !== false,
      installable: !installed,
      installKey,
      catalogSource,
    })

    if (!installed) {
      continue
    }

    for (const skill of plugin.skills || []) {
      const skillPath = buildCatalogPath([
        client,
        'skill',
        marketplace.name,
        normalizeSubdir(plugin.subdir),
        normalizeSubdir(skill.relativePath),
      ])
      entries.push({
        id: buildCatalogEntryId(client, 'skill', skill.name, skillPath),
        client,
        kind: 'skill',
        name: skill.name,
        description: skill.description,
        path: skillPath,
        source: pluginDisplayName,
        marketplace: marketplace.name,
        installed,
        official: plugin.official !== false,
        installable: !installed,
        installKey,
        parentPluginId: pluginId,
        parentPluginName: pluginDisplayName,
        catalogSource,
      })
    }

    if (client !== 'claude') {
      continue
    }

    for (const command of plugin.commands || []) {
      const commandPath = buildCatalogPath([
        client,
        'command',
        marketplace.name,
        normalizeSubdir(plugin.subdir),
        normalizeSubdir(command.relativePath),
      ])
      entries.push({
        id: buildCatalogEntryId('claude', 'command', command.name, commandPath),
        client: 'claude',
        kind: 'command',
        name: command.name,
        description: command.description,
        path: commandPath,
        source: pluginDisplayName,
        marketplace: marketplace.name,
        installed,
        official: plugin.official !== false,
        installable: !installed,
        installKey,
        parentPluginId: pluginId,
        parentPluginName: pluginDisplayName,
        catalogSource,
      })
    }
  }

  return entries
}
