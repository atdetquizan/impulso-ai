import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

@Injectable()
export class TokenCryptoService {
  private readonly key: Buffer;
  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('TOKEN_ENCRYPTION_KEY'), 'base64');
    if (this.key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
  }
  encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
  }
  decrypt(value: string) {
    const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
  createState(userId: string) {
    const payload = Buffer.from(JSON.stringify({ userId, nonce: randomBytes(16).toString('hex'), exp: Date.now() + 10 * 60_000 })).toString('base64url');
    const signature = createHmac('sha256', this.key).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }
  verifyState(state: string, expectedUserId: string) {
    const [payload, signature] = state.split('.');
    const expected = createHmac('sha256', this.key).update(payload).digest();
    const received = Buffer.from(signature, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { userId: string; exp: number };
    return decoded.userId === expectedUserId && decoded.exp > Date.now();
  }
}
