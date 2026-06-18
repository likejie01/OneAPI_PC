export type ImagePresetSize = '1024x1024' | '1024x1536' | '1536x1024'
export type ImagePresetQuality = 'medium' | 'high'

export type ImageStylePreset = {
  id: string
  title: string
  category: string
  description: string
  prompt: string
  size: ImagePresetSize
  quality?: ImagePresetQuality
  sourceTitle: string
  sourceUrl: string
  keywords?: string[]
}

export type ImageStylePresetViewItem = ImageStylePreset & {
  favorite: boolean
}

type BuiltinImageStylePresetSeed = {
  id: string
  title: string
  englishTitle: string
  sourceSlug: string
  galleryCount: number
  description: string
  prompt: string
  size: ImagePresetSize
  quality?: ImagePresetQuality
  keywords: string[]
}

const GPT_IMAGE_2_SOURCE_TITLE = 'GPT-Image2-Skill'

const LEGACY_MANAGED_IMAGE_STYLE_PRESET_IDS = new Set([
  'xhs-07',
  'xhs-01',
  'xhs-09',
  'xhs-02',
  'xhs-08',
  'xhs-05',
  'xhs-03',
  'reddit-03',
  'reddit-05',
  'reddit-08',
])

const IMAGE_STYLE_PRESET_SEEDS: BuiltinImageStylePresetSeed[] = [
  {
    id: 'gpt-image2-anime-and-manga',
    title: '动画与漫画',
    englishTitle: 'Anime & Manga',
    sourceSlug: 'gallery-anime-and-manga.md',
    galleryCount: 12,
    description: '二次元角色、分镜和赛璐璐上色',
    prompt: 'Create an original anime and manga visual. Use clean cel-shaded line art, expressive faces, dynamic pose or panel rhythm, a controlled high-saturation palette, layered environment storytelling, and crisp silhouette design. Keep the characters original and avoid any existing IP.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['anime', 'manga', 'cel shading', 'comic', '二次元', '漫画'],
  },
  {
    id: 'gpt-image2-gaming',
    title: '游戏',
    englishTitle: 'Gaming',
    sourceSlug: 'gallery-gaming.md',
    galleryCount: 10,
    description: '游戏镜头、HUD 和可玩场景氛围',
    prompt: 'Design an original in-game scene or key art with clear game-camera context, readable HUD or UI cues when relevant, playable space logic, environmental storytelling, and screenshot-grade lighting. Make it feel like a polished modern game capture rather than a generic fantasy illustration.',
    size: '1536x1024',
    quality: 'high',
    keywords: ['gaming', 'hud', 'game scene', 'screenshot', '游戏截图'],
  },
  {
    id: 'gpt-image2-retro-and-cyberpunk',
    title: '复古与赛博朋克',
    englishTitle: 'Retro & Cyberpunk',
    sourceSlug: 'gallery-retro-and-cyberpunk.md',
    galleryCount: 3,
    description: '霓虹材质、复古电子与未来都市板式',
    prompt: 'Create a retro-futurist cyberpunk board or poster with neon materials, chrome, CRT glow, scanline texture, modular props or characters, and a clear grid-based composition. Keep the designs original, high-contrast, and rooted in synthwave or dystopian city atmosphere.',
    size: '1024x1024',
    quality: 'high',
    keywords: ['cyberpunk', 'retro', 'synthwave', 'neon', '赛博朋克'],
  },
  {
    id: 'gpt-image2-cinematic-and-animation',
    title: '电影与动画',
    englishTitle: 'Cinematic & Animation',
    sourceSlug: 'gallery-cinematic-and-animation.md',
    galleryCount: 5,
    description: '电影级镜头调度和动画叙事定格',
    prompt: 'Create a cinematic animation frame or storyboard-style still with filmic composition, strong key light, motion-rich blocking, atmosphere depth, and a clear emotional beat. Use production-animation clarity rather than noisy photorealism.',
    size: '1536x1024',
    quality: 'high',
    keywords: ['cinematic', 'animation', 'storyboard', 'film still', '电影感'],
  },
  {
    id: 'gpt-image2-character-design',
    title: '角色设计',
    englishTitle: 'Character Design',
    sourceSlug: 'gallery-character-design.md',
    galleryCount: 2,
    description: '角色设定表、视图拆解和服装材质说明',
    prompt: 'Create an original character design sheet with a front or three-quarter hero pose, supporting views, costume or material callouts, expression variety, palette logic, and readable silhouette hierarchy. Make it feel like a production-ready design board.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['character design', 'reference sheet', 'turnaround', '角色设定'],
  },
  {
    id: 'gpt-image2-typography-and-posters',
    title: '字体设计和海报',
    englishTitle: 'Typography & Posters',
    sourceSlug: 'gallery-typography-and-posters.md',
    galleryCount: 13,
    description: '强调版式层级、可读性和海报节奏',
    prompt: 'Design a poster where typography hierarchy leads the composition. Put canvas ratio and layout first, keep all required display text in quotes, use crisp readable lettering, strong negative space, and intentional poster rhythm. Balance image and type like an editorial campaign asset.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['typography', 'poster', 'editorial', '海报', '排版'],
  },
  {
    id: 'gpt-image2-illustration',
    title: '插图',
    englishTitle: 'Illustration',
    sourceSlug: 'gallery-illustration.md',
    galleryCount: 2,
    description: '主题明确、叙事清晰的出版级插图',
    prompt: 'Create a polished illustration with a clear focal subject, intentional shape language, controlled palette, atmospheric depth, and strong narrative clarity. Keep the rendering refined and the composition clean enough for publication.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['illustration', 'editorial illustration', '叙事插图'],
  },
  {
    id: 'gpt-image2-watercolor',
    title: '水彩画',
    englishTitle: 'Watercolor',
    sourceSlug: 'gallery-watercolor.md',
    galleryCount: 2,
    description: '保留纸张肌理、晕染和透明叠色',
    prompt: 'Create a watercolor illustration with soft pigment blooms, paper grain, translucent layering, light edge bleed, and gentle tonal transitions. Preserve hand-painted texture and avoid digital plasticity.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['watercolor', 'paper grain', 'wash', '水彩'],
  },
  {
    id: 'gpt-image2-ink-and-chinese',
    title: '水墨与中国风',
    englishTitle: 'Ink & Chinese',
    sourceSlug: 'gallery-ink-and-chinese.md',
    galleryCount: 2,
    description: '笔触、留白和宣纸质感的东方画面',
    prompt: 'Create an ink-and-Chinese-style composition with brush energy, ink diffusion, rice-paper texture, restrained palette, calligraphic rhythm, and elegant empty space. Keep it original and culturally respectful rather than imitating a specific historical artwork.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['ink', 'chinese style', 'calligraphy', '水墨', '国风'],
  },
  {
    id: 'gpt-image2-pixel-art',
    title: '像素艺术',
    englishTitle: 'Pixel Art',
    sourceSlug: 'gallery-pixel-art.md',
    galleryCount: 2,
    description: '像素栅格、有限色盘和游戏素材感',
    prompt: 'Create clean pixel art with deliberate tile logic, readable clusters, controlled sprite-scale detail, limited palette discipline, and game-ready silhouettes. Preserve crisp edges and avoid smooth painterly rendering.',
    size: '1024x1024',
    quality: 'high',
    keywords: ['pixel art', 'sprite', 'tileset', '像素'],
  },
  {
    id: 'gpt-image2-isometric',
    title: '等距视角',
    englishTitle: 'Isometric',
    sourceSlug: 'gallery-isometric.md',
    galleryCount: 2,
    description: '正交等距结构、层高关系和地图逻辑',
    prompt: 'Create a true isometric scene with precise grid logic, consistent 30-degree projection, readable height changes, modular props, and strategy-game clarity. Keep the composition crisp, balanced, and easy to navigate at a glance.',
    size: '1024x1024',
    quality: 'high',
    keywords: ['isometric', 'grid', 'map', '等距'],
  },
  {
    id: 'gpt-image2-product-and-food',
    title: '产品与食品',
    englishTitle: 'Product & Food',
    sourceSlug: 'gallery-product-and-food.md',
    galleryCount: 4,
    description: '商业级产品主视觉和食物材质表现',
    prompt: 'Create a premium commercial render for the user subject. Use structured composition, material-specific lighting, micro-texture, strong hero framing, premium art direction, and appetizing or tactile surface detail. Prefer brand-campaign polish over cheap e-commerce styling.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['product', 'food', 'commercial', 'packshot', '产品海报'],
  },
  {
    id: 'gpt-image2-brand-systems-and-identity',
    title: '品牌系统与标识',
    englishTitle: 'Brand Systems & Identity',
    sourceSlug: 'gallery-brand-systems-and-identity.md',
    galleryCount: 3,
    description: '标识、色板、字体和延展物料展示',
    prompt: 'Create a brand system showcase board with original logo or wordmark exploration, palette chips, type hierarchy, packaging or social applications, and cohesive visual rules across touchpoints. Make it feel like a professional identity presentation.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['brand identity', 'logo', 'wordmark', 'branding', '品牌系统'],
  },
  {
    id: 'gpt-image2-photography',
    title: '摄影',
    englishTitle: 'Photography',
    sourceSlug: 'gallery-photography.md',
    galleryCount: 4,
    description: '真实拍摄语境、镜头感和自然瑕疵',
    prompt: 'Create a realistic photograph with explicit capture context, believable lens behavior, natural imperfections, grounded props, and location-specific lighting. Aim for documentary or editorial credibility instead of overprocessed AI gloss.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['photography', 'camera', 'editorial photo', '纪实摄影'],
  },
  {
    id: 'gpt-image2-infographics-and-field-guides',
    title: '信息图表和实地指南',
    englishTitle: 'Infographics & Field Guides',
    sourceSlug: 'gallery-infographics-and-field-guides.md',
    galleryCount: 8,
    description: '固定版区、注释和高可读信息板',
    prompt: 'Create a field guide or infographic board with fixed layout regions, exact labels in quotes when provided, clean module hierarchy, clear callouts, and classroom or museum-grade readability. Keep the structure disciplined and text legible.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['infographic', 'field guide', 'diagram board', '信息图', '指南'],
  },
  {
    id: 'gpt-image2-research-paper-figures',
    title: '研究论文图表',
    englishTitle: 'Research Paper Figures',
    sourceSlug: 'gallery-research-paper-figures.md',
    galleryCount: 21,
    description: '顶会级论文 Figure、流程图和方法示意',
    prompt: 'Create a landscape research figure with conference-paper grammar: panels, nodes, arrows, legends, exact labels in quotes, restrained academic colors, and publication-grade spacing. Prioritize diagram clarity over illustration flourish.',
    size: '1536x1024',
    quality: 'high',
    keywords: ['research paper', 'figure', 'academic', 'diagram', '论文配图'],
  },
  {
    id: 'gpt-image2-official-openai-cookbook-examples',
    title: 'OpenAI 官方 Cookbook 示例',
    englishTitle: 'Official OpenAI Cookbook Examples',
    sourceSlug: 'gallery-official-openai-cookbook-examples.md',
    galleryCount: 4,
    description: '以教程演示为导向的规范示例图',
    prompt: 'Create a practical GPT Image 2 reference example with clean structure, explicit task framing, and reproducible visual logic. The result should look like a polished cookbook demo that teaches a capability clearly.',
    size: '1536x1024',
    quality: 'high',
    keywords: ['openai cookbook', 'reference example', '示例图'],
  },
  {
    id: 'gpt-image2-edit-endpoint-showcase',
    title: '编辑端点展示',
    englishTitle: 'Edit Endpoint Showcase',
    sourceSlug: 'gallery-edit-endpoint-showcase.md',
    galleryCount: 2,
    description: '保留主体不变量的图像编辑与重风格化',
    prompt: 'Create an edit-style transformation while preserving the user-stated invariants. Keep the original composition or identity cues stable where requested, and show only the intended visual changes.',
    size: '1024x1024',
    quality: 'high',
    keywords: ['edit endpoint', 'image editing', 'restyle', '编辑'],
  },
  {
    id: 'gpt-image2-ui-ux-mockups',
    title: 'UI/UX 模型',
    englishTitle: 'UI/UX Mockups',
    sourceSlug: 'gallery-ui-ux-mockups.md',
    galleryCount: 5,
    description: '产品规格式界面、真实数据和精确排版',
    prompt: 'Create a production-quality UI or app mockup with clear product context, device or canvas constraints, real information architecture, plausible data, crisp typography, and precise spacing. It should read like a product spec rendered into a usable interface.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['ui/ux', 'mockup', 'dashboard', 'app design', '界面设计'],
  },
  {
    id: 'gpt-image2-data-visualization',
    title: '数据可视化',
    englishTitle: 'Data Visualization',
    sourceSlug: 'gallery-data-visualization.md',
    galleryCount: 5,
    description: '图表族、编码规则和一致标尺的可视化',
    prompt: 'Create a publication-grade data visualization with an explicit chart family, consistent scales, exact labels in quotes, clear legend logic, and strong visual encoding. Keep the layout clean, analytical, and easy to read.',
    size: '1536x1024',
    quality: 'high',
    keywords: ['data visualization', 'chart', 'graph', '图表'],
  },
  {
    id: 'gpt-image2-technical-illustration',
    title: '技术插图',
    englishTitle: 'Technical Illustration',
    sourceSlug: 'gallery-technical-illustration.md',
    galleryCount: 5,
    description: '爆炸图、结构件说明和编号标注',
    prompt: 'Create a technical illustration or exploded view with ordered components, numbered callouts, material differentiation, blueprint-like clarity, and precise structural logic. Make every annotation feel instructional.',
    size: '1536x1024',
    quality: 'high',
    keywords: ['technical illustration', 'exploded view', 'blueprint', '技术图解'],
  },
  {
    id: 'gpt-image2-architecture-and-interior',
    title: '建筑与室内设计',
    englishTitle: 'Architecture & Interior',
    sourceSlug: 'gallery-architecture-and-interior.md',
    galleryCount: 5,
    description: '空间材质、镜头视角和真实光影关系',
    prompt: 'Create an architectural or interior scene with a clear room or building type, realistic materials, a believable camera or lens feel, directional lighting, negative space, and accurate shadow behavior. Keep the scene calm, buildable, and publication-ready.',
    size: '1536x1024',
    quality: 'high',
    keywords: ['architecture', 'interior', 'room', 'render', '室内设计'],
  },
  {
    id: 'gpt-image2-scientific-and-educational',
    title: '科学与教育',
    englishTitle: 'Scientific & Educational',
    sourceSlug: 'gallery-scientific-and-educational.md',
    galleryCount: 7,
    description: '课堂或科普场景下的学术说明板',
    prompt: 'Create a scientific or educational board with exact subject naming, layered annotations, classroom-grade hierarchy, clean legend structure, a restrained academic palette, and strong explanatory clarity. Avoid decorative clutter.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['scientific', 'educational', 'classroom chart', '科学科普'],
  },
  {
    id: 'gpt-image2-fashion-editorial',
    title: '时尚专题',
    englishTitle: 'Fashion Editorial',
    sourceSlug: 'gallery-fashion-editorial.md',
    galleryCount: 7,
    description: '杂志化造型、姿态和高级布光',
    prompt: 'Create a fashion editorial image with styled wardrobe direction, magazine-grade composition, purposeful pose, premium lighting, material realism, and refined color grading. Keep it tasteful, adult, and publication-ready.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['fashion', 'editorial', 'magazine', '时尚大片'],
  },
  {
    id: 'gpt-image2-fine-art-painting',
    title: '精美艺术绘画',
    englishTitle: 'Fine Art Painting',
    sourceSlug: 'gallery-fine-art-painting.md',
    galleryCount: 5,
    description: '强调媒介逻辑和画廊级完成度的艺术绘画',
    prompt: 'Create a fine art painting with clear medium logic, deliberate brushwork, tonal hierarchy, compositional depth, and gallery-grade finish. Keep it original instead of imitating a known painting.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['fine art', 'painting', 'brushwork', '艺术绘画'],
  },
  {
    id: 'gpt-image2-more-illustration-styles',
    title: '更多插画风格',
    englishTitle: 'More Illustration Styles',
    sourceSlug: 'gallery-more-illustration-styles.md',
    galleryCount: 6,
    description: '装饰性、叙事性和手工感更强的插画分支',
    prompt: 'Create an original illustration that can flex into stylized, decorative, or narrative modes while keeping strong composition, a controlled palette, and readable subject hierarchy. Preserve a distinct handcrafted feel.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['illustration styles', 'decorative', 'narrative illustration', '插画风格'],
  },
  {
    id: 'gpt-image2-cinematic-film-references',
    title: '电影参考资料',
    englishTitle: 'Cinematic Film References',
    sourceSlug: 'gallery-cinematic-film-references.md',
    galleryCount: 6,
    description: '原创新片段的镜头参考与情绪定格',
    prompt: 'Create a cinematic film reference still with strong shot design, believable production lighting, lens-aware framing, atmosphere depth, and a specific emotional beat. It should feel like a frame from an original film.',
    size: '1536x1024',
    quality: 'high',
    keywords: ['film reference', 'movie still', 'cinematic reference', '电影参考'],
  },
  {
    id: 'gpt-image2-beauty-and-lifestyle',
    title: '美妆与生活方式',
    englishTitle: 'Beauty & Lifestyle',
    sourceSlug: 'gallery-beauty-and-lifestyle.md',
    galleryCount: 2,
    description: '柔和商业布光下的美妆和生活方式场景',
    prompt: 'Create a beauty or lifestyle image with soft premium lighting, clean styling, aspirational mood, tactile surface detail, and polished editorial composition. Keep the subject elegant and commercially usable.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['beauty', 'lifestyle', 'cosmetics', '美妆'],
  },
  {
    id: 'gpt-image2-events-and-experience',
    title: '活动与体验',
    englishTitle: 'Events & Experience',
    sourceSlug: 'gallery-events-and-experience.md',
    galleryCount: 2,
    description: '场地、参与感和品牌触点并存的活动视觉',
    prompt: 'Create an event or experience visual with venue context, crowd or participation cues when relevant, layered signage or touchpoints, and an immersive sense of moment. Balance brand clarity with lived atmosphere.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['event', 'experience', 'venue', '活动视觉'],
  },
  {
    id: 'gpt-image2-tattoo-design',
    title: '纹身设计',
    englishTitle: 'Tattoo Design',
    sourceSlug: 'gallery-tattoo-design.md',
    galleryCount: 4,
    description: '可落针的线稿、明暗和 flash sheet 展示',
    prompt: 'Create a tattoo design or flash sheet for the requested subject. Specify tattooable placement logic, clean linework, shading style, negative-space gaps, and a presentation that works as tattoo art rather than a generic illustration. Do not place it on real skin unless the user explicitly asks.',
    size: '1024x1536',
    quality: 'high',
    keywords: ['tattoo', 'flash sheet', 'linework', '纹身'],
  },
  {
    id: 'gpt-image2-screen-photography',
    title: '屏幕摄影',
    englishTitle: 'Screen Photography',
    sourceSlug: 'gallery-screen-photography.md',
    galleryCount: 2,
    description: '设备实拍语境下的屏幕显示与环境反射',
    prompt: 'Create a realistic screen photography shot showing a monitor, laptop, phone, or interface in context with believable reflections, moire-free readability, device framing, and natural desk or room lighting. It should feel like a real captured screen, not a direct screenshot.',
    size: '1536x1024',
    quality: 'high',
    keywords: ['screen photography', 'monitor', 'device shot', '屏幕实拍'],
  },
]

function cloneImageStylePreset(item: ImageStylePreset) {
  return {
    ...item,
    keywords: item.keywords ? [...item.keywords] : undefined,
  }
}

function createManagedImageStylePreset(seed: BuiltinImageStylePresetSeed): ImageStylePreset {
  return {
    id: seed.id,
    title: seed.title,
    category: seed.title,
    description: `参考 ${seed.galleryCount} 条图例；${seed.description}`,
    prompt: seed.prompt,
    size: seed.size,
    quality: seed.quality ?? 'high',
    sourceTitle: GPT_IMAGE_2_SOURCE_TITLE,
    sourceUrl: `https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/${seed.sourceSlug}`,
    keywords: [seed.englishTitle, seed.sourceSlug, ...seed.keywords],
  }
}

export const IMAGE_STYLE_PRESETS: ImageStylePreset[] = IMAGE_STYLE_PRESET_SEEDS.map(createManagedImageStylePreset)

const MANAGED_IMAGE_STYLE_PRESET_IDS = new Set(IMAGE_STYLE_PRESETS.map((item) => item.id))

export function isManagedImageStylePresetId(id: string) {
  return MANAGED_IMAGE_STYLE_PRESET_IDS.has(id)
}

export function createBuiltinImageStylePresets() {
  return IMAGE_STYLE_PRESETS.map(cloneImageStylePreset)
}

export function mergeImageStylePresetsWithBuiltins(stored: ImageStylePreset[]) {
  const builtins = createBuiltinImageStylePresets()
  const storedById = new Map(stored.map((item) => [item.id, item]))
  const mergedBuiltins = builtins.map((item) => ({
    ...item,
    ...(storedById.get(item.id) || {}),
  }))
  const custom = stored.filter((item) => {
    if (isManagedImageStylePresetId(item.id)) {
      return false
    }
    return !LEGACY_MANAGED_IMAGE_STYLE_PRESET_IDS.has(item.id)
  })
  return [...mergedBuiltins, ...custom]
}

export function decorateImageStylePresets(
  presets: ImageStylePreset[],
  favoriteIds: string[],
  searchValue: string
) {
  const favoriteIndex = new Map(favoriteIds.map((id, index) => [id, index]))
  const normalizedSearch = searchValue.trim().toLowerCase()

  return presets
    .filter((item) => {
      if (!normalizedSearch) {
        return true
      }
      return [
        item.title,
        item.category,
        item.description,
        item.prompt,
        item.sourceTitle,
        ...(item.keywords || []),
      ].some((value) => value.toLowerCase().includes(normalizedSearch))
    })
    .map((item) => ({
      ...item,
      favorite: favoriteIndex.has(item.id),
    }))
    .sort((left, right) => {
      const leftRank = favoriteIndex.has(left.id) ? 1 : 0
      const rightRank = favoriteIndex.has(right.id) ? 1 : 0
      if (leftRank !== rightRank) {
        return rightRank - leftRank
      }
      if (leftRank && rightRank) {
        return (favoriteIndex.get(left.id) || 0) - (favoriteIndex.get(right.id) || 0)
      }
      return left.title.localeCompare(right.title, 'zh-Hans-CN')
    })
}

export function groupImageStylePresetsByCategory(presets: ImageStylePreset[]) {
  const groups = new Map<string, ImageStylePreset[]>()
  for (const item of presets) {
    const current = groups.get(item.category) || []
    current.push(item)
    groups.set(item.category, current)
  }
  return [...groups.entries()]
}

export function buildImageStyleAugmentedPrompt(
  draft: string,
  preset: Pick<ImageStylePreset, 'prompt'>
) {
  const normalizedDraft = draft.trim()
  const normalizedPreset = preset.prompt.trim()
  if (!normalizedPreset) {
    return normalizedDraft
  }
  if (!normalizedDraft) {
    return normalizedPreset
  }
  return `${normalizedPreset}\n\n补充要求：\n${normalizedDraft}`
}
