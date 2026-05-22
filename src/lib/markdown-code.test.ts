import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMarkdownCodeBlockContent } from './markdown-code.ts'

test('normalizeMarkdownCodeBlockContent trims one trailing newline and normalizes line endings', () => {
  assert.equal(normalizeMarkdownCodeBlockContent('line 1\r\nline 2\r\n'), 'line 1\nline 2')
  assert.equal(normalizeMarkdownCodeBlockContent('line 1\nline 2'), 'line 1\nline 2')
})
