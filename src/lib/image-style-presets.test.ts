import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildImageStyleAugmentedPrompt,
  decorateImageStylePresets,
  groupImageStylePresetsByCategory,
  IMAGE_STYLE_PRESETS,
  mergeImageStylePresetsWithBuiltins,
} from './image-style-presets.ts'

test('buildImageStyleAugmentedPrompt prepends the preset prompt and keeps user additions', () => {
  assert.equal(
    buildImageStyleAugmentedPrompt('主体改成猫咪咖啡馆。', {
      prompt: 'Create a premium poster with soft studio lighting.',
    }),
    ['Create a premium poster with soft studio lighting.', '', '补充要求：', '主体改成猫咪咖啡馆。'].join('\n')
  )
})

test('IMAGE_STYLE_PRESETS mirrors the 31 GPT-Image2-Skill categories', () => {
  assert.equal(IMAGE_STYLE_PRESETS.length, 31)
  assert.equal(new Set(IMAGE_STYLE_PRESETS.map((item) => item.title)).size, 31)
  assert.ok(IMAGE_STYLE_PRESETS.some((item) => item.title === '动画与漫画'))
  assert.ok(IMAGE_STYLE_PRESETS.some((item) => item.title === '研究论文图表'))
  assert.ok(IMAGE_STYLE_PRESETS.some((item) => item.title === '屏幕摄影'))
})

test('groupImageStylePresetsByCategory keeps presets grouped by category', () => {
  const grouped = groupImageStylePresetsByCategory(IMAGE_STYLE_PRESETS)
  assert.equal(grouped.length, 31)
  assert.ok(grouped.some(([category, items]) => category === '研究论文图表' && items.length === 1))
  assert.ok(grouped.some(([category, items]) => category === '游戏' && items.length === 1))
})

test('mergeImageStylePresetsWithBuiltins keeps builtin overrides and custom presets', () => {
  const merged = mergeImageStylePresetsWithBuiltins([
    {
      ...IMAGE_STYLE_PRESETS[0],
      title: '商业产品海报-已修改',
      description: 'override',
    },
    {
      id: 'custom-style-1',
      title: '我的风格',
      category: '自定义',
      description: 'keep',
      prompt: 'keep',
      size: '1024x1024',
      quality: 'high',
      sourceTitle: '自定义助手',
      sourceUrl: '',
    },
  ])

  assert.equal(merged.find((item) => item.id === IMAGE_STYLE_PRESETS[0]?.id)?.title, '商业产品海报-已修改')
  assert.ok(merged.some((item) => item.id === 'custom-style-1'))
})

test('mergeImageStylePresetsWithBuiltins drops legacy sample presets from earlier builds', () => {
  const merged = mergeImageStylePresetsWithBuiltins([
    {
      id: 'xhs-07',
      title: '旧版商业产品海报',
      category: '产品与海报',
      description: 'legacy',
      prompt: 'legacy',
      size: '1024x1536',
      quality: 'high',
      sourceTitle: '旧版内置',
      sourceUrl: '',
    },
    {
      id: 'custom-style-2',
      title: '我的保留风格',
      category: '自定义',
      description: 'keep',
      prompt: 'keep',
      size: '1024x1024',
      quality: 'high',
      sourceTitle: '自定义助手',
      sourceUrl: '',
    },
  ])

  assert.equal(merged.some((item) => item.id === 'xhs-07'), false)
  assert.equal(merged.some((item) => item.id === 'custom-style-2'), true)
})

test('decorateImageStylePresets prioritizes favorites and searches by aliases', () => {
  const decorated = decorateImageStylePresets(
    IMAGE_STYLE_PRESETS,
    ['gpt-image2-ui-ux-mockups'],
    'ui/ux'
  )

  assert.deepEqual(
    decorated.map((item) => ({
      id: item.id,
      favorite: item.favorite,
    })),
    [
      {
        id: 'gpt-image2-ui-ux-mockups',
        favorite: true,
      },
    ]
  )
})
