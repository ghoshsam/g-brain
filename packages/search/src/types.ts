import type { SearchHit, SearchQuery } from '@g-brain/core'

export interface Retriever {
  search(query: SearchQuery): Promise<SearchHit[]>
  similar(body: string, folder: string, limit: number): Promise<SearchHit[]>
}

/**
 * Defined and unimplemented. Enabling hybrid retrieval is an implementation of
 * this plus SEARCH_MODE, with no caller changed. See ADR-0004.
 */
export interface Embedder {
  dimensions: number
  embed(texts: string[]): Promise<Float32Array[]>
}
