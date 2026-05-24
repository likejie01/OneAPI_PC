import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isMermaidMarkdownCodeBlock,
  normalizeMarkdownCodeBlockContent,
  shouldRenderMarkdownCodeBlock,
} from './markdown-code.ts'

test('normalizeMarkdownCodeBlockContent trims one trailing newline and normalizes line endings', () => {
  assert.equal(normalizeMarkdownCodeBlockContent('line 1\r\nline 2\r\n'), 'line 1\nline 2')
  assert.equal(normalizeMarkdownCodeBlockContent('line 1\nline 2'), 'line 1\nline 2')
})

test('shouldRenderMarkdownCodeBlock hides empty fenced blocks', () => {
  assert.equal(shouldRenderMarkdownCodeBlock('language-ts', '\n'), false)
  assert.equal(shouldRenderMarkdownCodeBlock('language-ts', '   \n'), false)
  assert.equal(shouldRenderMarkdownCodeBlock('language-ts', 'const value = 1\n'), true)
  assert.equal(shouldRenderMarkdownCodeBlock(undefined, 'inline'), false)
})

test('isMermaidMarkdownCodeBlock recognizes mermaid fenced blocks', () => {
  assert.equal(isMermaidMarkdownCodeBlock('language-mermaid'), true)
  assert.equal(isMermaidMarkdownCodeBlock('foo language-mermaid bar'), true)
  assert.equal(isMermaidMarkdownCodeBlock('language-ts'), false)
  assert.equal(isMermaidMarkdownCodeBlock(undefined), false)
})
