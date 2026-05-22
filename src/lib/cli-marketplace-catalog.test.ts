import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBundledCodexCuratedSkillEntries,
  buildBundledMarketplaceEntries,
  buildCodexCuratedSkillInstallKey,
  type BundledCodexCuratedSkillCatalog,
  type BundledPluginMarketplaceCatalog,
} from './cli-marketplace-catalog.ts'

test('buildBundledCodexCuratedSkillEntries creates installable catalog entries with git source metadata', () => {
  const catalog: BundledCodexCuratedSkillCatalog = {
    repoUrl: 'https://github.com/openai/skills.git',
    sha: 'abc123',
    skills: [
      {
        id: 'playwright',
        name: 'playwright',
        description: 'Automate browsers',
        repoPath: 'skills/.curated/playwright',
      },
    ],
  }

  const [entry] = buildBundledCodexCuratedSkillEntries(catalog, new Set())
  assert.equal(entry.installKey, buildCodexCuratedSkillInstallKey('playwright'))
  assert.equal(entry.installed, false)
  assert.equal(entry.catalogSource?.repoUrl, 'https://github.com/openai/skills.git')
  assert.equal(entry.catalogSource?.sha, 'abc123')
  assert.equal(entry.catalogSource?.subdir, 'skills/.curated/playwright')
  assert.match(entry.path, /^catalog:\/\/codex\/skill\//)
})

test('buildBundledMarketplaceEntries carries install state and plugin parent metadata to children', () => {
  const catalog: BundledPluginMarketplaceCatalog = {
    name: 'openai-curated',
    repoUrl: 'https://github.com/openai/plugins.git',
    sha: 'def456',
    plugins: [
      {
        name: 'build-web-apps',
        displayName: 'Build Web Apps',
        description: 'Build web apps',
        subdir: 'plugins/build-web-apps',
        skills: [
          {
            name: 'frontend-app-builder',
            description: 'Build frontend apps',
            relativePath: 'skills/frontend-app-builder/SKILL.md',
          },
        ],
      },
    ],
  }

  const entries = buildBundledMarketplaceEntries('codex', catalog, new Set(['build-web-apps@openai-curated']))
  const plugin = entries.find((item) => item.kind === 'plugin')
  const skill = entries.find((item) => item.kind === 'skill')

  assert.equal(plugin?.installed, true)
  assert.equal(plugin?.installable, false)
  assert.equal(plugin?.catalogSource?.repoUrl, 'https://github.com/openai/plugins.git')
  assert.equal(plugin?.catalogSource?.subdir, 'plugins/build-web-apps')
  assert.equal(skill?.installed, true)
  assert.equal(skill?.installKey, 'build-web-apps@openai-curated')
  assert.equal(skill?.parentPluginId, plugin?.id)
  assert.equal(skill?.parentPluginName, 'Build Web Apps')
})

test('buildBundledMarketplaceEntries keeps raw source metadata for claude marketplace plugins', () => {
  const catalog: BundledPluginMarketplaceCatalog = {
    name: 'claude-plugins-official',
    repoUrl: 'https://github.com/anthropics/claude-plugins-official.git',
    sha: 'ghi789',
    plugins: [
      {
        name: 'agent-sdk-dev',
        description: 'Development kit',
        subdir: './plugins/agent-sdk-dev',
        source: './plugins/agent-sdk-dev',
        commands: [
          {
            name: 'create-plugin',
            description: 'Create a plugin',
            relativePath: 'commands/create-plugin.md',
          },
        ],
      },
    ],
  }

  const entries = buildBundledMarketplaceEntries('claude', catalog, new Set())
  const plugin = entries.find((item) => item.kind === 'plugin')
  const command = entries.find((item) => item.kind === 'command')

  assert.equal(plugin?.catalogSource?.repoUrl, 'https://github.com/anthropics/claude-plugins-official.git')
  assert.equal(plugin?.catalogSource?.subdir, 'plugins/agent-sdk-dev')
  assert.equal(plugin?.catalogSource?.rawSource, './plugins/agent-sdk-dev')
  assert.equal(command?.parentPluginName, 'agent-sdk-dev')
  assert.equal(command?.installKey, 'agent-sdk-dev@claude-plugins-official')
})
