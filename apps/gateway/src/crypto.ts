import crypto from 'node:crypto';

// 판매자 업스트림 API 키 암호화 (AES-256-GCM).
// 저장 포맷: base64(iv[12] | authTag[16] | ciphertext)

function masterKey(): Buffer {
  const hex = process.env.HAWKER_MASTER_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('HAWKER_MASTER_KEY(32-byte hex)가 설정되지 않았습니다. `openssl rand -hex 32`로 생성하세요.');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptSecret(stored: string): string {
  const buf = Buffer.from(stored, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
