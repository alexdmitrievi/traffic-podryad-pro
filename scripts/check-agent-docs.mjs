/**
 * Asserts that CLAUDE.md and AGENTS.md are byte-identical.
 *
 * The two files exist because different agents look for different names. They carry the
 * architecture and compliance rules, so a drift between them means one agent is working
 * from stale instructions — the failure mode is silent and only shows up as a rule quietly
 * not being followed. Comparing bytes rather than content is deliberate: any difference at
 * all, including whitespace, is a drift.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const agentDocumentPair = ['CLAUDE.md', 'AGENTS.md']

/**
 * @param {{path: string, bytes: Uint8Array}[]} documents
 * @returns {{ok: true, bytes: number} | {ok: false, reason: string}}
 */
export function compareAgentDocuments(documents) {
  if (documents.length !== 2) {
    return { ok: false, reason: `expected exactly 2 agent documents, received ${documents.length}` }
  }

  const [left, right] = documents

  if (left.bytes.length !== right.bytes.length) {
    return {
      ok: false,
      reason: `${left.path} is ${left.bytes.length} bytes and ${right.path} is ${right.bytes.length} bytes`,
    }
  }

  for (let index = 0; index < left.bytes.length; index += 1) {
    if (left.bytes[index] !== right.bytes[index]) {
      const line = new TextDecoder().decode(left.bytes.slice(0, index)).split('\n').length
      return {
        ok: false,
        reason: `${left.path} and ${right.path} differ at byte ${index} (around line ${line})`,
      }
    }
  }

  return { ok: true, bytes: left.bytes.length }
}

async function main() {
  const documents = []
  for (const name of agentDocumentPair) {
    try {
      documents.push({
        path: name,
        bytes: new Uint8Array(await readFile(path.join(repositoryRoot, name))),
      })
    } catch (error) {
      if (error?.code === 'ENOENT') {
        console.error(`Agent document check failed: ${name} is missing.`)
        process.exitCode = 1
        return
      }
      throw error
    }
  }

  const result = compareAgentDocuments(documents)

  if (!result.ok) {
    console.error(`Agent document check failed: ${result.reason}.`)
    console.error('CLAUDE.md and AGENTS.md must be byte-identical; change both in the same commit.')
    process.exitCode = 1
    return
  }

  console.log(`Agent document check passed: CLAUDE.md and AGENTS.md are identical (${result.bytes} bytes).`)
}

if (import.meta.main) await main()
