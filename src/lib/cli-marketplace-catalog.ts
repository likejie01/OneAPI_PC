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

  for (const plugin of marketplace.plugins) {
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
