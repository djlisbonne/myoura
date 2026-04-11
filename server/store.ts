import { randomUUID } from 'crypto'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import path from 'path'

import { STORE_VERSION, nowIso, type StoreState, type StoredDocument, type SyncRun } from './lib.js'

function defaultState(): StoreState {
  const now = nowIso()
  return {
    version: STORE_VERSION,
    createdAt: now,
    updatedAt: now,
    documents: [],
    syncRuns: [],
  }
}

function dedupeDocuments(documents: StoredDocument[]): StoredDocument[] {
  const map = new Map<string, StoredDocument>()
  for (const document of documents) {
    map.set(document.id, document)
  }
  return [...map.values()].sort((left, right) => right.x.localeCompare(left.x))
}

export class JsonStore {
  private state: StoreState | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async init(): Promise<StoreState> {
    await this.load()
    return this.snapshot()
  }

  private async load(): Promise<void> {
    if (this.state) {
      return
    }

    await mkdir(path.dirname(this.filePath), { recursive: true })

    try {
      const contents = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(contents) as Partial<StoreState>
      this.state = {
        ...defaultState(),
        ...parsed,
        version: STORE_VERSION,
        documents: Array.isArray(parsed.documents) ? dedupeDocuments(parsed.documents as StoredDocument[]) : [],
        syncRuns: Array.isArray(parsed.syncRuns) ? (parsed.syncRuns as SyncRun[]) : [],
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const corruptPath = `${this.filePath}.corrupt-${Date.now()}-${randomUUID()}`
        try {
          await writeFile(corruptPath, JSON.stringify({ error: String(error) }, null, 2), 'utf8')
        } catch {
          // Best effort only.
        }
      }
      this.state = defaultState()
      await this.flush()
    }
  }

  private snapshot(): StoreState {
    if (!this.state) {
      return defaultState()
    }
    return structuredClone(this.state)
  }

  private async flush(): Promise<void> {
    if (!this.state) {
      return
    }
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, JSON.stringify(this.state, null, 2), 'utf8')
    await rename(tempPath, this.filePath)
  }

  async read(): Promise<StoreState> {
    await this.load()
    return this.snapshot()
  }

  async update<T>(mutator: (state: StoreState) => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      await this.load()
      if (!this.state) {
        this.state = defaultState()
      }
      const result = await mutator(this.state)
      this.state.updatedAt = nowIso()
      await this.flush()
      return result
    })

    this.queue = next.then(
      () => undefined,
      () => undefined,
    )

    return next
  }

  async replaceDocuments(documents: StoredDocument[], syncRun?: SyncRun): Promise<StoreState> {
    return this.update((state) => {
      state.documents = dedupeDocuments(documents)
      if (syncRun) {
        state.syncRuns = [syncRun, ...state.syncRuns].slice(0, 50)
      }
      return this.snapshot()
    })
  }

  async mergeDocuments(documents: StoredDocument[], syncRun?: SyncRun): Promise<StoreState> {
    return this.update((state) => {
      const merged = new Map(state.documents.map((document) => [document.id, document] as const))
      for (const document of documents) {
        merged.set(document.id, document)
      }
      state.documents = [...merged.values()].sort((left, right) => right.x.localeCompare(left.x))
      if (syncRun) {
        state.syncRuns = [syncRun, ...state.syncRuns].slice(0, 50)
      }
      return this.snapshot()
    })
  }

  async appendSyncRun(syncRun: SyncRun): Promise<StoreState> {
    return this.update((state) => {
      state.syncRuns = [syncRun, ...state.syncRuns].slice(0, 50)
      return this.snapshot()
    })
  }

  async resetDocuments(documents: StoredDocument[], syncRun?: SyncRun): Promise<StoreState> {
    return this.replaceDocuments(documents, syncRun)
  }
}

