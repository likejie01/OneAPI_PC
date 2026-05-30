const SEARCH_MARK_SELECTOR = '.conversation-search-mark'
const SEARCH_BUBBLE_SELECTOR = '.conversation-search-hit, .conversation-search-hit-active'

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function unwrapSearchMark(mark: HTMLElement) {
  const parent = mark.parentNode
  if (!parent) {
    return
  }

  parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
  parent.normalize()
}

function collectTextNodes(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text)) {
        return NodeFilter.FILTER_REJECT
      }

      const parent = node.parentElement
      if (!parent || parent.closest(SEARCH_MARK_SELECTOR)) {
        return NodeFilter.FILTER_REJECT
      }

      const text = node.textContent || ''
      return text.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })

  const nodes: Text[] = []
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text)
  }
  return nodes
}

export function clearConversationSearchHighlights(container: HTMLElement | null) {
  if (!container) {
    return
  }

  container.querySelectorAll<HTMLElement>(SEARCH_MARK_SELECTOR).forEach(unwrapSearchMark)
  container.querySelectorAll<HTMLElement>(SEARCH_BUBBLE_SELECTOR).forEach((node) => {
    node.classList.remove('conversation-search-hit', 'conversation-search-hit-active')
  })
}

export function applyConversationSearchHighlights(
  container: HTMLElement | null,
  itemSelector: string,
  query: string
) {
  if (!container) {
    return [] as HTMLElement[]
  }

  clearConversationSearchHighlights(container)
  const keyword = query.trim()
  if (!keyword) {
    return [] as HTMLElement[]
  }

  const pattern = new RegExp(escapeRegExp(keyword), 'gi')
  const marks: HTMLElement[] = []

  Array.from(container.querySelectorAll<HTMLElement>(itemSelector)).forEach((item) => {
    for (const textNode of collectTextNodes(item)) {
      const text = textNode.textContent || ''
      pattern.lastIndex = 0

      const ranges: Array<{ start: number; end: number }> = []
      for (let matched = pattern.exec(text); matched !== null; matched = pattern.exec(text)) {
        ranges.push({
          start: matched.index,
          end: matched.index + matched[0].length,
        })
      }

      if (!ranges.length) {
        continue
      }

      const fragment = document.createDocumentFragment()
      let cursor = 0
      for (const range of ranges) {
        if (range.start > cursor) {
          fragment.appendChild(document.createTextNode(text.slice(cursor, range.start)))
        }

        const mark = document.createElement('mark')
        mark.className = 'conversation-search-mark'
        mark.textContent = text.slice(range.start, range.end)
        fragment.appendChild(mark)
        marks.push(mark)
        cursor = range.end
      }

      if (cursor < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)))
      }

      textNode.parentNode?.replaceChild(fragment, textNode)
    }
  })

  const owningBubbles = new Set<HTMLElement>()
  marks.forEach((mark) => {
    const owner = mark.closest<HTMLElement>(itemSelector)
    if (owner) {
      owningBubbles.add(owner)
    }
  })
  owningBubbles.forEach((owner) => owner.classList.add('conversation-search-hit'))

  return marks
}
