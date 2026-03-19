import Redis from 'ioredis';
import { CONFIG } from '../config';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(CONFIG.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    client.on('error', err => console.error('[Redis] Error:', err.message));
    client.on('connect', () => console.log('[Redis] Connected.'));
  }
  return client;
}
