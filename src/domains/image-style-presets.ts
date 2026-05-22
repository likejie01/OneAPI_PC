import {
  createBuiltinImageStylePresets,
  mergeImageStylePresetsWithBuiltins,
  type ImagePresetQuality,
  type ImagePresetSize,
  type ImageStylePreset,
} from '../lib/image-style-presets'
import { readJsonStorage, writeJsonStorage } from '../lib/storage'

const STORAGE_KEY = 'oneapi-desktop-image-style-presets'

export function loadImageStylePresets() {
  const presets = readJsonStorage<ImageStylePreset[]>(STORAGE_KEY, [])
  return presets.length > 0 ? mergeImageStylePresetsWithBuiltins(presets) : createBuiltinImageStylePresets()
}

export function saveImageStylePresets(presets: ImageStylePreset[]) {
  writeJsonStorage(STORAGE_KEY, presets)
}

export function createImageStylePreset(input: {
  title: string
  category: string
  description: string
  prompt: string
  size: ImagePresetSize
  quality?: ImagePresetQuality
}) {
  return {
    id: globalThis.crypto.randomUUID(),
    title: input.title,
    category: input.category,
    description: input.description,
    prompt: input.prompt,
    size: input.size,
    quality: input.quality,
    sourceTitle: '自定义助手',
    sourceUrl: '',
  } satisfies ImageStylePreset
}
