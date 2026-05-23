import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Globe, Link2 } from 'lucide-react'
import { normalizeMarkdownCodeBlockContent } from '../lib/markdown-code'
import { extractMessageLinkChips } from '../lib/message-links'

interface MarkdownMessageContentProps {
  content: string
  onOpenLocalPath: (targetPath: string) => void | Promise<void>
  onOpenExternal: (targetUrl: string) => void | Promise<void>
}

export function MarkdownMessageContent(props: MarkdownMessageContentProps) {
  const { content, onOpenExternal, onOpenLocalPath } = props
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const extractedContent = useMemo(() => extractMessageLinkChips(content), [content])

  useEffect(() => {
    if (!copiedCode) {
      return
    }
    const timer = window.setTimeout(() => setCopiedCode(null), 1600)
    return () => window.clearTimeout(timer)
  }, [copiedCode])

  return (
    <div className='markdown-body'>
      {extractedContent.chips.length > 0 ? (
        <div className='message-link-chip-strip'>
          {extractedContent.chips.map((item) => (
            <button
              key={`${item.kind}:${item.url}`}
              type='button'
              className='message-link-chip'
              title={item.url}
              onClick={() => void onOpenExternal(item.url)}
            >
              <span className='message-link-chip-icon'>
                {item.kind === 'github' ? <Link2 size={14} /> : <Globe size={14} />}
              </span>
              <span className='message-link-chip-copy'>
                <strong>{item.label}</strong>
                <small>{item.hostLabel}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {extractedContent.content ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              const target = href || ''
              const isLocalPath =
                /^file:\/\//i.test(target) ||
                /^[A-Za-z]:[\\/]/.test(target) ||
                /^\/(Users|home|var|private|Volumes)\//.test(target)

              if (isLocalPath) {
                const resolved = target.replace(/^file:\/\/\/?/i, '')
                return (
                  <button
                    type='button'
                    className='markdown-inline-link'
                    onClick={() => void onOpenLocalPath(decodeURIComponent(resolved))}
                  >
                    {children}
                  </button>
                )
              }

              return (
                <a
                  href={target}
                  target='_blank'
                  rel='noreferrer'
                  onClick={(event) => {
                    event.preventDefault()
                    void onOpenExternal(target)
                  }}
                >
                  {children}
                </a>
              )
            },
            code: ({ className, children, ...rest }) => {
              const rawText = String(children ?? '')
              const normalizedText = normalizeMarkdownCodeBlockContent(rawText)
              const isBlock = /(^|\s)language-/.test(className || '') || /\n/.test(rawText)

              if (!isBlock) {
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
    </div>
  )
}
