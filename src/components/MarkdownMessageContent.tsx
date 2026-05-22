import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownMessageContentProps {
  content: string
  onOpenLocalPath: (targetPath: string) => void | Promise<void>
  onOpenExternal: (targetUrl: string) => void | Promise<void>
}

export function MarkdownMessageContent(props: MarkdownMessageContentProps) {
  const { content, onOpenExternal, onOpenLocalPath } = props

  return (
    <div className='markdown-body'>
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
