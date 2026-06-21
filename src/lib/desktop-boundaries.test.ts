import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createCliAccessDirectoryResolver,
  FILE_PREVIEW_MAX_BYTES,
  readFilePreview,
  resolveOpenTarget,
  assertAllowedExternalUrl,
} from '../../electron/desktop-boundaries.ts'

test('external url validation keeps only browser-safe protocols', () => {
  assert.equal(assertAllowedExternalUrl('https://example.com/path?q=1'), 'https://example.com/path?q=1')
  assert.equal(assertAllowedExternalUrl('mailto:test@example.com'), 'mailto:test@example.com')
  assert.throws(() => assertAllowedExternalUrl('file:///C:/Windows/System32'), /不支持打开 file: 协议链接/)
  assert.throws(() => assertAllowedExternalUrl('not a url'), /外部链接格式无效/)
})

test('resolveOpenTarget returns existing directories and containing folders for files or missing children', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oneapi-open-target-'))
  try {
    const childDir = path.join(root, 'child')
    const childFile = path.join(childDir, 'note.txt')
    await mkdir(childDir)
    await writeFile(childFile, 'hello')

    assert.equal(await resolveOpenTarget(childDir), childDir)
    assert.equal(await resolveOpenTarget(childFile), childDir)
    assert.equal(await resolveOpenTarget(path.join(childDir, 'missing.txt')), childDir)
    assert.equal(await resolveOpenTarget(path.join(root, 'missing', 'file.txt')), '')
    assert.equal(await resolveOpenTarget('   '), '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('readFilePreview reads small files and rejects directories or oversized files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oneapi-preview-'))
  try {
    const smallFile = path.join(root, 'note.txt')
    await writeFile(smallFile, 'hello')
    assert.deepEqual(await readFilePreview(smallFile), {
      path: path.resolve(smallFile),
      name: 'note.txt',
      content: 'hello',
    })

    await assert.rejects(() => readFilePreview(root), /当前路径不是文件/)

    const largeFile = path.join(root, 'large.txt')
    const oversized = Buffer.alloc(FILE_PREVIEW_MAX_BYTES + 1, 'a')
    await writeFile(largeFile, oversized)
    await assert.rejects(() => readFilePreview(largeFile), /文件超过 10MB/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cli access directory resolver keeps project, attachments, and remembered open target folders', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oneapi-cli-access-'))
  try {
    const project = path.join(root, 'project')
    const attachments = path.join(root, 'attachments')
    const opened = path.join(root, 'opened')
    const openedFile = path.join(opened, 'note.txt')
    await mkdir(project)
    await mkdir(attachments)
    await mkdir(opened)
    await writeFile(openedFile, 'hello')

    const resolver = createCliAccessDirectoryResolver(() => attachments)
    await resolver.rememberOpenTarget(openedFile)

    assert.deepEqual(
      resolver.resolve(project).sort(),
      [path.resolve(project), path.resolve(attachments), path.resolve(opened)].sort()
    )

    resolver.rememberDirectory('   ')
    assert.deepEqual(
      resolver.resolve('   ').sort(),
      [path.resolve(attachments), path.resolve(opened)].sort()
    )
    assert.equal((await stat(opened)).isDirectory(), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
