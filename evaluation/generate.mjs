#!/usr/bin/env node
/**
 * Phase 1: Einfrieren der Kanal- und Richterausgaben.
 *
 * Die Kanalantworten werden einmal erzeugt und danach nie neu erzeugt. Alle Lanes arbeiten
 * ausschließlich auf diesen Dateien — damit ist der Vergleich der Arbitrierungswege unabhängig
 * von Modellrauschen. Prüfsummen der Anordnung, des Korpus und der Auswertung landen im Manifest.
 *
 * Aufruf: node evaluation/generate.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHANNELS,
  JUDGE_MODEL,
  ORDER_INSTRUCTION,
  chat,
  hashFile,
  loadCorpus,
  shuffled,
} from './lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const frozenDir = path.join(here, 'frozen')
fs.mkdirSync(frozenDir, { recursive: true })

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number' },
    abstain: { type: 'boolean' },
    rationale: { type: 'string' },
  },
  required: ['answer', 'confidence', 'abstain', 'rationale'],
  additionalProperties: false,
}

async function pool(lanes, worker, size = 4) {
  const queue = [...lanes]
  const results = []
  const run = async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      results.push(await worker(item))
    }
  }
  await Promise.all(Array.from({ length: size }, run))
  return results
}

const corpus = loadCorpus()

/* ------------------------------------------------- Kanalantworten einfrieren */
const tasks = corpus.items.flatMap((item) => CHANNELS.map((channel) => ({ item, channel })))
let done = 0
const rows = await pool(
  tasks,
  async ({ item, channel }) => {
    const started = Date.now()
    let content = null
    let error = null
    for (let attempt = 1; attempt <= 3 && content === null; attempt += 1) {
      try {
        content = await chat(
          channel.model,
          [
            { role: 'system', content: ORDER_INSTRUCTION },
            { role: 'user', content: item.prompt },
          ],
          { maxTokens: 900 },
        )
      } catch (cause) {
        error = String(cause.message ?? cause)
        await new Promise((r) => setTimeout(r, 1500 * attempt))
      }
    }
    done += 1
    process.stdout.write(`\rKanalantworten: ${done}/${tasks.length}`)
    return {
      itemId: item.id,
      channelId: channel.id,
      model: channel.model,
      family: channel.family,
      ms: Date.now() - started,
      content,
      error,
    }
  },
  4,
)
process.stdout.write('\n')

const failedChannels = rows.filter((r) => r.content === null)
if (failedChannels.length > 0) {
  console.error(`${failedChannels.length} Kanalantworten fehlgeschlagen:`, failedChannels.slice(0, 3))
}

const channelOutputs = {
  generatedAt: new Date().toISOString(),
  channels: CHANNELS,
  orderInstruction: ORDER_INSTRUCTION,
  byItem: Object.fromEntries(
    corpus.items.map((item) => [
      item.id,
      Object.fromEntries(rows.filter((r) => r.itemId === item.id).map((r) => [r.channelId, r])),
    ]),
  ),
}
fs.writeFileSync(path.join(frozenDir, 'channel-outputs.json'), JSON.stringify(channelOutputs, null, 2))

/* --------------------------------------------------- Richter einfrieren (2×) */
const judgeTasks = corpus.items.map((item) => ({ item, run: 1 }))
for (const task of [...judgeTasks]) judgeTasks.push({ ...task, run: 2 })

let judgeDone = 0
const judgeRows = await pool(
  judgeTasks,
  async ({ item, run }) => {
    const answers = CHANNELS.map((channel) => ({
      channel,
      text: channelOutputs.byItem[item.id][channel.id]?.content ?? '',
    }))
    // Anonymisierte, je Eintrag feste Reihenfolge: Der Richter sieht keine Anbieter und keine Gewichte.
    const anonymous = shuffled(answers, `${item.id}-ordnung`)
    const labels = ['A', 'B', 'C', 'D']
    const evidence = anonymous
      .map((entry, index) => `Answer ${labels[index]}:\n${entry.text}`)
      .join('\n\n')

    const messages = [
      {
        role: 'system',
        content:
          'You are an independent arbiter. You receive one question and several candidate answers from anonymous sources. Decide which answer is factually correct using only the passage given in the question. Ignore style, length, confidence wording and the number of answers that agree: if a majority agrees on something wrong, say what is right. If no candidate is defensible, set abstain to true and put the empty string in answer. Return only JSON.',
      },
      { role: 'user', content: `Question:\n${item.prompt}\n\n${evidence}\n\nDecide.` },
    ]

    let parsed = null
    let error = null
    for (let attempt = 1; attempt <= 3 && parsed === null; attempt += 1) {
      try {
        const raw = await chat(JUDGE_MODEL, messages, { schema: JUDGE_SCHEMA, maxTokens: 1200 })
        parsed = JSON.parse(raw)
      } catch (cause) {
        error = String(cause.message ?? cause)
        await new Promise((r) => setTimeout(r, 1500 * attempt))
      }
    }
    judgeDone += 1
    process.stdout.write(`\rRichterantworten: ${judgeDone}/${judgeTasks.length}`)
    return {
      itemId: item.id,
      run,
      order: anonymous.map((entry) => entry.channel.id),
      answer: parsed?.answer ?? null,
      confidence: typeof parsed?.confidence === 'number' ? parsed.confidence : null,
      abstain: parsed?.abstain ?? null,
      rationale: parsed?.rationale ?? null,
      error,
    }
  },
  4,
)
process.stdout.write('\n')

const judgeOutputs = {
  generatedAt: new Date().toISOString(),
  judgeModel: JUDGE_MODEL,
  schema: JUDGE_SCHEMA,
  runs: judgeRows,
}
fs.writeFileSync(path.join(frozenDir, 'judge-runs.json'), JSON.stringify(judgeOutputs, null, 2))

/* ------------------------------------------------------------------ Manifest */
const manifest = {
  frozenAt: new Date().toISOString(),
  hashes: {
    preregistration: hashFile(path.join(here, 'PREREGISTRATION.md')),
    corpus: hashFile(path.join(here, 'corpus.json')),
    evaluationLib: hashFile(path.join(here, 'lib.mjs')),
    channelOutputs: hashFile(path.join(frozenDir, 'channel-outputs.json')),
    judgeRuns: hashFile(path.join(frozenDir, 'judge-runs.json')),
  },
  channelsFailed: failedChannels.length,
  judgeFailed: judgeRows.filter((r) => r.answer === null).length,
}
fs.writeFileSync(path.join(frozenDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2))

console.log('Eingefroren:', JSON.stringify(manifest.hashes, null, 2))
console.log(`Kanäle fehlgeschlagen: ${manifest.channelsFailed}, Richter fehlgeschlagen: ${manifest.judgeFailed}`)