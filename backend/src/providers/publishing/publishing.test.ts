import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { runPublishingContractSuite } from './contract-suite'
import { createFakePublishingDriver } from './fake-driver'
import { createFilesystemPublishingDriver } from './filesystem-driver'

describe('the fake publishing driver', () => {
  runPublishingContractSuite(() => createFakePublishingDriver())

  test('records every publish call for inspection', async () => {
    const driver = createFakePublishingDriver()
    await driver.publish({
      contentItemId: 'a',
      revisionId: 'b',
      slug: 'slug-a',
      html: '<p>a</p>',
      bodyMarkdown: 'a',
      title: 'A',
      description: null,
    })

    expect(driver.calls()).toBe(1)
    expect(driver.published().get('slug-a')?.revisionId).toBe('b')
  })
})

describe('the filesystem publishing driver', () => {
  let directory: string

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pipupi-publish-'))
  })

  afterAll(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(directory, { recursive: true, force: true })
  })

  runPublishingContractSuite(() =>
    createFilesystemPublishingDriver({ rootDirectory: directory }),
  )

  test('writes the rendered html and the site sources to files named after the slug', async () => {
    const driver = createFilesystemPublishingDriver({ rootDirectory: directory })
    await driver.publish({
      contentItemId: 'a',
      revisionId: 'b',
      slug: 'slug-fs',
      html: '<html>тело</html>',
      bodyMarkdown: '# тело',
      title: 'Тело',
      description: 'Описание тела',
    })

    const content = await readFile(path.join(directory, 'slug-fs.html'), 'utf8')
    expect(content).toBe('<html>тело</html>')

    const markdown = await readFile(path.join(directory, 'slug-fs.md'), 'utf8')
    expect(markdown).toBe('# тело')

    const meta = JSON.parse(await readFile(path.join(directory, 'slug-fs.meta.json'), 'utf8'))
    expect(meta).toEqual(
      expect.objectContaining({ slug: 'slug-fs', title: 'Тело', description: 'Описание тела' }),
    )
  })
})
