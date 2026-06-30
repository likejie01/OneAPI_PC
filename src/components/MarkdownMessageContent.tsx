import {
  Children,
  cloneElement,
  isValidElement,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy } from 'lucide-react'
import {
  isMermaidMarkdownCodeBlock,
  normalizeMarkdownCodeBlockContent,
  shouldRenderMarkdownCodeBlock,
} from '../lib/markdown-code'
import { extractMessageLinkChips } from '../lib/message-links'
import { resolveSelectionContextMenuText } from '../lib/context-menu'
import { appendMarkdownLinkSuffix, resolveMarkdownLinkTarget, splitBareFilePathLinks, type BareFilePathPart } from '../lib/file-links'

const MermaidDiagramLazy = lazy(async () => {
  const module = await import('./MermaidDiagram')
  return { default: module.MermaidDiagram }
})

interface MarkdownMessageContentProps {
  content: string
  onOpenLocalPath: (targetPath: string) => void | Promise<void>
  onOpenExternal: (targetUrl: string) => void | Promise<void>
  onLocalPathContextMenu?: (event: ReactMouseEvent<HTMLElement>, targetPath: string) => void
  onSelectionContextMenu?: (event: ReactMouseEvent<HTMLDivElement>, selectedText: string) => void
  localPathBase?: string
  renderMermaid?: boolean
}

interface MarkdownTextLinkOptions {
  localPathBase?: string
  onOpenLocalPath: (targetPath: string) => void | Promise<void>
  onLocalPathContextMenu?: (event: ReactMouseEvent<HTMLElement>, targetPath: string) => void
}

function renderLocalPathLink(
  part: Extract<BareFilePathPart, { kind: 'local' }>,
  key: string,
  options: MarkdownTextLinkOptions,
) {
  return (
    <button
      key={key}
      type='button'
      className='markdown-inline-link'
      onClick={() => void options.onOpenLocalPath(part.path)}
      onContextMenu={(event) => {
        if (!options.onLocalPathContextMenu) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        options.onLocalPathContextMenu(event, part.path)
      }}
    >
      {part.text}
    </button>
  )
}

function linkifyMarkdownText(text: string, options: MarkdownTextLinkOptions) {
  const parts = splitBareFilePathLinks(text, options.localPathBase)
  if (parts.length === 1 && parts[0]?.kind === 'text') {
    return text
  }
  return parts.map((part, index) => (
    part.kind === 'local'
      ? renderLocalPathLink(part, `local-path:${index}:${part.text}`, options)
      : part.text
  ))
}

function linkifyMarkdownTextChildren(children: ReactNode, options: MarkdownTextLinkOptions): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string') {
      const text = child
      return linkifyMarkdownText(text, options)
    }

    if (!isValidElement(child)) {
      return child
    }

    if (typeof child.type === 'string' && ['a', 'button', 'code', 'pre'].includes(child.type)) {
      return child
    }

    const element = child as ReactElement<{ children?: ReactNode }>
    if (!element.props.children) {
      return child
    }

    return cloneElement(element, {
      children: linkifyMarkdownTextChildren(element.props.children, options),
    })
  })
}

function flattenTextChildren(children: ReactNode): string[] {
  const parts: string[] = []
  Children.forEach(children, (child) => {
    if (typeof child === 'string') {
      parts.push(child)
      return
    }
    if (typeof child === 'number') {
      parts.push(String(child))
      return
    }
    if (isValidElement(child)) {
      parts.push(...flattenTextChildren((child as ReactElement<{ children?: ReactNode }>).props.children))
    }
  })
  return parts
}

function removeConsumedLinkSuffix(children: ReactNode, consumedChildren: string[]) {
  if (!consumedChildren.length) {
    return children
  }
  let remaining = consumedChildren.join('')
  return Children.map(children, (child) => {
    if (!remaining) {
      return child
    }
    if (typeof child !== 'string') {
      return child
    }
    if (!remaining || !child.startsWith(remaining)) {
      return child
    }
    const nextChild = child.slice(remaining.length)
    remaining = ''
    return nextChild
  })
}

export function MarkdownMessageContent(props: MarkdownMessageContentProps) {
  const {
    content,
    localPathBase,
    onLocalPathContextMenu,
    onOpenExternal,
    onOpenLocalPath,
    onSelectionContextMenu,
    renderMermaid = true,
  } = props
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const extractedContent = useMemo(() => extractMessageLinkChips(content), [content])
  const rootRef = useRef<HTMLDivElement | null>(null)
  const markdownTextLinkOptions = useMemo<MarkdownTextLinkOptions>(() => ({
    localPathBase,
    onLocalPathContextMenu,
    onOpenLocalPath,
  }), [localPathBase, onLocalPathContextMenu, onOpenLocalPath])

  useEffect(() => {
    if (!copiedCode) {
      return
    }
    const timer = window.setTimeout(() => setCopiedCode(null), 1600)
    return () => window.clearTimeout(timer)
  }, [copiedCode])

  return (
    <div
      className='markdown-body'
      ref={rootRef}
      onContextMenu={(event) => {
        if (!onSelectionContextMenu) {
          return
        }
        const selectedText = resolveSelectionContextMenuText(rootRef.current, window.getSelection())
        if (!selectedText) {
          return
        }
        event.preventDefault()
        onSelectionContextMenu(event, selectedText)
      }}
    >
      {extractedContent.content ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => (
              <p>{linkifyMarkdownTextChildren(children, markdownTextLinkOptions)}</p>
            ),
            li: ({ children, ...rest }) => (
              <li {...rest}>{linkifyMarkdownTextChildren(children, markdownTextLinkOptions)}</li>
            ),
            td: ({ children, ...rest }) => (
              <td {...rest}>{linkifyMarkdownTextChildren(children, markdownTextLinkOptions)}</td>
            ),
            th: ({ children, ...rest }) => (
              <th {...rest}>{linkifyMarkdownTextChildren(children, markdownTextLinkOptions)}</th>
            ),
            blockquote: ({ children, ...rest }) => (
              <blockquote {...rest}>{linkifyMarkdownTextChildren(children, markdownTextLinkOptions)}</blockquote>
            ),
            a: ({ href, children }) => {
              const target = href || ''
              const suffixFixedTarget = appendMarkdownLinkSuffix(target, flattenTextChildren(children))
              const resolvedTarget = resolveMarkdownLinkTarget(suffixFixedTarget.href, localPathBase)
              const renderedChildren = removeConsumedLinkSuffix(children, suffixFixedTarget.consumedChildren)

              if (resolvedTarget.kind === 'local') {
                return (
                  <button
                    type='button'
                    className='markdown-inline-link'
                    onClick={() => void onOpenLocalPath(resolvedTarget.path)}
                    onContextMenu={(event) => {
                      if (!onLocalPathContextMenu) {
                        return
                      }
                      event.preventDefault()
                      event.stopPropagation()
                      onLocalPathContextMenu(event, resolvedTarget.path)
                    }}
                  >
                    {renderedChildren}
                  </button>
                )
              }

              if (resolvedTarget.kind === 'ignored') {
                return <span>{renderedChildren}</span>
              }

              return (
                <a
                  href={resolvedTarget.url}
                  target='_blank'
                  rel='noreferrer'
                  onClick={(event) => {
                    event.preventDefault()
                    void onOpenExternal(resolvedTarget.url)
                  }}
                >
                  {renderedChildren}
                </a>
              )
            },
            code: ({ className, children, ...rest }) => {
              const rawText = String(children ?? '')
              const normalizedText = normalizeMarkdownCodeBlockContent(rawText)

              if (isMermaidMarkdownCodeBlock(className)) {
                if (!renderMermaid) {
                  return <code className={className} {...rest}>{normalizedText}</code>
                }
                return normalizedText.trim() ? (
                  <Suspense fallback={<code className={className}>{normalizedText}</code>}>
                    <MermaidDiagramLazy chart={normalizedText} />
                  </Suspense>
                ) : null
              }

              const isBlock = shouldRenderMarkdownCodeBlock(className, rawText)

              if (!isBlock) {
                if (/(^|\s)language-/.test(className || '') || /\n/.test(rawText)) {
                  return null
                }
                return <code className={className} {...rest}>{children}</code>
              }

              const copied = copiedCode === normalizedText
              return (
                <span className='markdown-code-block'>
                  <button
                    type='button'
                    className='markdown-code-copy'
                    aria-label='复制代码'
                    title={copied ? '已复制' : '复制代码'}
                    onClick={() => {
                      void navigator.clipboard.writeText(normalizedText)
                      setCopiedCode(normalizedText)
                    }}
                  >
                    <Copy size={13} />
                  </button>
                  <code className={className} {...rest}>
                    {normalizedText}
                  </code>
                </span>
              )
            },
          }}
        >
          {extractedContent.content}
        </ReactMarkdown>
      ) : null}
      {extractedContent.chips.length > 0 ? (
        <div className='message-link-chip-strip message-link-text-strip' aria-label='相关链接'>
          {extractedContent.chips.map((item) => (
            <a
              key={`${item.kind}:${item.url}`}
              className='message-link-chip message-link-text'
              href={item.url}
              target='_blank'
              rel='noreferrer'
              onClick={(event) => {
                event.preventDefault()
                void onOpenExternal(item.url)
              }}
            >
              {item.url}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  )
}
