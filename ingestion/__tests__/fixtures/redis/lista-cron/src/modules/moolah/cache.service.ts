// @ts-nocheck — fixture
import { redisClient } from '../../utils/redis';

export class MoolahCacheService {
  async getRoot() {
    return await redisClient.get('moolah:emission:pending_root');
  }
  async setStatus(addr: string) {
    await redisClient.set(`moolah:claim_status:${addr}`, '1', 600);
  }
  async expireRoot() {
    await redisClient.expire('moolah:emission:pending_root', 600);
  }
  async byPrefix() {
    const KEY_PREFIX = 'foo';
    return redisClient.get(KEY_PREFIX + ':bar');  // expression — should be SKIPPED
  }
}
