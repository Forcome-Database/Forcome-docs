import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';

export interface WikiConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

const KEY_PREFIX = 'wiki:conv:';
const MAX_TURNS = 6;      // 6 turns = 12 messages
const MAX_BYTES = 50_000;  // 50 KB hard cap
const TTL_SECONDS = 86400; // 24 hours

@Injectable()
export class WikiConversationStore {
  private readonly redis: Redis;

  constructor(private readonly redisService: RedisService) {
    this.redis = this.redisService.getOrThrow();
  }

  private buildKey(sessionId: string, requesterKey?: string): string {
    const suffix = requesterKey || 'anonymous';
    return `${KEY_PREFIX}${suffix}:${sessionId}`;
  }

  private buildLegacyKey(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}`;
  }

  async load(sessionId: string, requesterKey?: string): Promise<WikiConversationMessage[] | null> {
    const raw = await this.redis.get(this.buildKey(sessionId, requesterKey));
    if (raw) {
      try {
        const data = JSON.parse(raw);
        return Array.isArray(data.messages) ? data.messages : null;
      } catch {
        return null;
      }
    }

    // Backwards compat: try legacy key format and migrate if found
    const legacyRaw = await this.redis.get(this.buildLegacyKey(sessionId));
    if (!legacyRaw) return null;
    try {
      const data = JSON.parse(legacyRaw);
      const messages = Array.isArray(data.messages) ? data.messages : null;
      if (messages) {
        // Migrate to new key format and remove legacy key
        await this.save(sessionId, messages, requesterKey);
        await this.redis.del(this.buildLegacyKey(sessionId));
      }
      return messages;
    } catch {
      return null;
    }
  }

  async save(sessionId: string, messages: WikiConversationMessage[], requesterKey?: string): Promise<void> {
    const key = this.buildKey(sessionId, requesterKey);

    // Keep last MAX_TURNS turns (each turn = 2 messages)
    const pruned = messages.slice(-(MAX_TURNS * 2));
    const payload = JSON.stringify({ messages: pruned });

    // Hard cap — if too large, keep minimal recent history
    if (Buffer.byteLength(payload, 'utf8') > MAX_BYTES) {
      const minimal = pruned.slice(-4); // last 2 turns
      const minPayload = JSON.stringify({ messages: minimal });
      await this.redis.setex(key, TTL_SECONDS, minPayload);
      return;
    }

    await this.redis.setex(key, TTL_SECONDS, payload);
  }

  async delete(sessionId: string, requesterKey?: string): Promise<void> {
    await this.redis.del(this.buildKey(sessionId, requesterKey));
  }
}
