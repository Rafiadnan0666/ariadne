import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Simple vector storage using cosine similarity
// Note: For production, use a proper vector DB. This is a lightweight implementation.

export interface ContextChunk {
  id: number;
  tabId: string;
  url: string;
  title: string;
  content: string;
  chunkIndex: number;
  embedding: number[]; // Vector representation
  tokenCount: number;
  timestamp: number;
}

export interface EmbeddingProviderConfig {
  enabled: boolean;
  providerId: string; // e.g., 'openai', 'openai-embedding', etc.
  model: string;
  apiKeyRef?: string;
}

export class EmbeddingStore {
  private dbPath: string;
  private chunks: Map<number, ContextChunk> = new Map<number, ContextChunk>();
  private nextId = 1;
  private embeddingProviderId: string = 'none'; // 'none', 'openai', 'custom'

  constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'ariadne-embeddings.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.dbPath)) {
        const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'));
        this.chunks = new Map<number, ContextChunk>(
          Object.entries(data.chunks || {}).map(([id, chunk]) => [Number(id), chunk as ContextChunk])
        );
        this.nextId = Math.max(...this.chunks.keys(), 0) + 1;
      }
    } catch (error) {
      console.error('[EmbeddingStore] Failed to load:', error);
    }
  }

  private save(): void {
    try {
      const data = {
        chunks: Object.fromEntries(this.chunks.entries()),
      };
      fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[EmbeddingStore] Failed to save:', error);
    }
  }

  setEmbeddingProvider(providerId: string): void {
    this.embeddingProviderId = providerId;
  }

  getEmbeddingProvider(): string {
    return this.embeddingProviderId;
  }

  // Compute cosine similarity between two vectors
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Store a chunk with its embedding
  async addChunk(chunk: Omit<ContextChunk, 'id' | 'timestamp'>): Promise<number> {
    const id = this.nextId++;
    const record: ContextChunk = {
      ...chunk,
      id,
      timestamp: Date.now(),
    };
    this.chunks.set(id, record);
    this.save();
    return id;
  }

  // Retrieve most relevant chunks based on query
  // Returns up to maxChunks most similar chunks
  async retrieve(query: string, tabIds?: string[], maxChunks: number = 10): Promise<ContextChunk[]> {
    // In a real implementation, this would:
    // 1. Generate embedding for the query
    // 2. Compute similarity to all chunks
    // 3. Return top-k by similarity
    
    // For now, return chunks that match keywords in content
    // In Phase 4, this will use actual embedding provider
    const relevantChunks = Array.from(this.chunks.values())
      .filter(chunk => {
        if (tabIds && !tabIds.includes(chunk.tabId)) return false;
        return this.keywordMatch(query, chunk.content);
      })
      .sort((a, b) => {
        const aScore = this.keywordMatch(query, a.content) ? 1 : 0;
        const bScore = this.keywordMatch(query, b.content) ? 1 : 0;
        return bScore - aScore;
      })
      .slice(0, maxChunks);

    return relevantChunks;
  }

  // Chunk content into smaller pieces for better retrieval
  async chunkContent(text: string, maxTokens: number = 8000): Promise<ContextChunk[]> {
    const chunks: ContextChunk[] = [];
    
    // Simple chunking by sentences
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
    
    let currentChunk = '';
    let chunkIndex = 0;
    
    for (const sentence of sentences) {
      if ((currentChunk + ' ' + sentence).length > maxTokens * 4) {
        if (currentChunk) {
          chunks.push({
            id: 0, // Will be assigned on save
            tabId: '',
            url: '',
            title: '',
            content: currentChunk,
            chunkIndex,
            embedding: [],
            tokenCount: currentChunk.length,
            timestamp: 0,
          });
          chunkIndex++;
          currentChunk = sentence;
        } else {
          currentChunk = sentence;
        }
      } else {
        currentChunk = currentChunk ? currentChunk + ' ' + sentence : sentence;
      }
    }
    
    if (currentChunk) {
      chunks.push({
        id: 0,
        tabId: '',
        url: '',
        title: '',
        content: currentChunk,
        chunkIndex,
        embedding: [],
        tokenCount: currentChunk.length,
        timestamp: 0,
      });
    }
    
    return chunks;
  }

  // Placeholder for actual embedding generation
  // In Phase 4, this will call an embedding provider
  async generateEmbedding(text: string): Promise<number[]> {
    // For testing, return a simple hash-based vector
    // In production, call embedding API
    const hash = this.simpleHash(text);
    return Array.from({ length: 1536 }, (_, i) => (hash + i) % 1000 / 1000);
  }

  // In-memory keyword matching
  private keywordMatch(query: string, content: string): boolean {
    const queryWords = query.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();
    const matchCount = queryWords.filter(w => contentLower.includes(w)).length;
    return matchCount >= Math.max(1, Math.ceil(queryWords.length * 0.3));
  }

  // Simple hash function for vector generation
  private simpleHash(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  // Delete chunks for a tab
  deleteByTabId(tabId: string): void {
    for (const [id, chunk] of this.chunks) {
      if (chunk.tabId === tabId) {
        this.chunks.delete(id);
      }
    }
    this.save();
  }

  // Get all chunks for statistics
  getStats(): { totalChunks: number; tabs: number } {
    const tabs = new Set<string>();
    for (const chunk of this.chunks.values()) {
      tabs.add(chunk.tabId);
    }
    return { totalChunks: this.chunks.size, tabs: tabs.size };
  }
}

export const embeddingStore = new EmbeddingStore();