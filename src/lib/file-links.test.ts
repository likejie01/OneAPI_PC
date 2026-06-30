import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendMarkdownLinkSuffix,
  isRelativeLocalPath,
  resolveMarkdownLinkTarget,
  splitBareFilePathLinks,
} from './file-links.ts'

test('markdown links resolve relative project files against the cli project path', () => {
  assert.deepEqual(
    resolveMarkdownLinkTarget('README.md', 'D:\\WorkSpace\\Codex-Manager'),
    { kind: 'local', path: 'D:\\WorkSpace\\Codex-Manager\\README.md' }
  )
  assert.deepEqual(
    resolveMarkdownLinkTarget('crates/service/src/auth/auth_login.rs', 'D:\\WorkSpace\\Codex-Manager'),
    { kind: 'local', path: 'D:\\WorkSpace\\Codex-Manager\\crates/service/src/auth/auth_login.rs' }
  )
  assert.deepEqual(
    resolveMarkdownLinkTarget('docs/zh-CN/report/%E6%96%87%E6%A1%A3.md#section', 'D:\\WorkSpace\\Codex-Manager'),
    { kind: 'local', path: 'D:\\WorkSpace\\Codex-Manager\\docs/zh-CN/report/文档.md' }
  )
})

test('markdown links keep external urls external and ignore anchors', () => {
  assert.deepEqual(resolveMarkdownLinkTarget('https://example.com/a'), { kind: 'external', url: 'https://example.com/a' })
  assert.deepEqual(resolveMarkdownLinkTarget('mailto:test@example.com'), { kind: 'external', url: 'mailto:test@example.com' })
  assert.deepEqual(resolveMarkdownLinkTarget('#section', 'D:\\WorkSpace\\Demo'), { kind: 'ignored' })
  assert.equal(isRelativeLocalPath('javascript:alert(1)'), false)
})

test('markdown relative file links without a project base keep legacy external handling', () => {
  assert.deepEqual(resolveMarkdownLinkTarget('README.md'), { kind: 'external', url: 'README.md' })
})

test('bare cli file paths are split into local links without matching api route text', () => {
  assert.deepEqual(
    splitBareFilePathLinks(
      '账号在 README.md 写明，接口是 /v1，注册不是 signup/register；见 crates/service/src/auth/auth_login.rs 和 docs/zh-CN/report/不登陆Codex使用ChatGPT-auth-session导入账号.md。',
      'D:\\WorkSpace\\Codex-Manager',
    ),
    [
      { kind: 'text', text: '账号在 ' },
      { kind: 'local', text: 'README.md', path: 'D:\\WorkSpace\\Codex-Manager\\README.md' },
      { kind: 'text', text: ' 写明，接口是 /v1，注册不是 signup/register；见 ' },
      {
        kind: 'local',
        text: 'crates/service/src/auth/auth_login.rs',
        path: 'D:\\WorkSpace\\Codex-Manager\\crates/service/src/auth/auth_login.rs',
      },
      { kind: 'text', text: ' 和 ' },
      {
        kind: 'local',
        text: 'docs/zh-CN/report/不登陆Codex使用ChatGPT-auth-session导入账号.md',
        path: 'D:\\WorkSpace\\Codex-Manager\\docs/zh-CN/report/不登陆Codex使用ChatGPT-auth-session导入账号.md',
      },
      { kind: 'text', text: '。' },
    ],
  )
})

test('bare windows file paths recover extensions split by markdown whitespace', () => {
  assert.deepEqual(
    splitBareFilePathLinks(
      '见 D:\\WorkSpace\\Codex-Manager\\docs\\zh-CN\\report\\不登陆Codex使用ChatGPT-auth-session导入账号. md)',
      'D:\\WorkSpace\\Codex-Manager',
    ),
    [
      { kind: 'text', text: '见 ' },
      {
        kind: 'local',
        text: 'D:\\WorkSpace\\Codex-Manager\\docs\\zh-CN\\report\\不登陆Codex使用ChatGPT-auth-session导入账号.md',
        path: 'D:\\WorkSpace\\Codex-Manager\\docs\\zh-CN\\report\\不登陆Codex使用ChatGPT-auth-session导入账号.md',
      },
    ],
  )
})

test('markdown links recover file suffixes split outside the href by unescaped local paths', () => {
  const recovered = appendMarkdownLinkSuffix('D:\\WorkSpace\\Codex-Manager\\README', ['. md'])
  assert.equal(recovered.href, 'D:\\WorkSpace\\Codex-Manager\\README.md')
  assert.deepEqual(recovered.consumedChildren, ['. md'])
  assert.deepEqual(
    resolveMarkdownLinkTarget(recovered.href, 'D:\\WorkSpace\\Codex-Manager'),
    { kind: 'local', path: 'D:\\WorkSpace\\Codex-Manager\\README.md' },
  )

  const chinese = appendMarkdownLinkSuffix(
    'D:\\WorkSpace\\Codex-Manager\\docs\\zh-CN\\report\\不登陆Codex使用ChatGPT-auth-session导入账号',
    ['. md) 和后续正文'],
  )
  assert.equal(chinese.href, 'D:\\WorkSpace\\Codex-Manager\\docs\\zh-CN\\report\\不登陆Codex使用ChatGPT-auth-session导入账号.md')
  assert.deepEqual(chinese.consumedChildren, ['. md)'])
})
