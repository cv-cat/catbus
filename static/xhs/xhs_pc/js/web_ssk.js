'use strict';

const crypto = require('crypto');

const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const SERVER_PUBLIC_KEY = Buffer.from(
  'Kr0iygsCu3inYJNXCL4k4JuzaYQ2afI1xbwc7BH6sm8=',
  'base64',
);

function privateKeyFromRaw(raw) {
  const value = Buffer.from(raw);
  if (value.length !== 32) throw new Error('X25519 private key must be 32 bytes');
  return crypto.createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, value]),
    format: 'der',
    type: 'pkcs8',
  });
}

function publicKeyFromRaw(raw) {
  const value = Buffer.from(raw);
  if (value.length !== 32) throw new Error('X25519 public key must be 32 bytes');
  return crypto.createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, value]),
    format: 'der',
    type: 'spki',
  });
}

function createHandshake() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  return {
    private_key_base64: privateDer.subarray(-32).toString('base64'),
    client_public_key_base64: publicDer.subarray(-32).toString('base64'),
  };
}

function acceptSsk(privateKeyBase64, encryptedSskBase64, serverPublicKey = SERVER_PUBLIC_KEY) {
  const privateKey = privateKeyFromRaw(Buffer.from(String(privateKeyBase64), 'base64'));
  const publicKey = publicKeyFromRaw(Buffer.from(serverPublicKey));
  const sharedSecret = crypto.diffieHellman({ privateKey, publicKey });
  const encrypted = Buffer.from(String(encryptedSskBase64), 'base64');
  if (encrypted.length < 12 + 16) throw new Error('encrypted SSK is truncated');
  const nonce = encrypted.subarray(0, 12);
  const payload = encrypted.subarray(12);
  const ciphertext = payload.subarray(0, -16);
  const tag = payload.subarray(-16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', sharedSecret, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plain.length < 32) throw new Error('decrypted SSK is too short');
  return plain.toString('base64');
}

function main() {
  const input = JSON.parse(process.argv[2] || '{}');
  if (input.action === 'create') {
    process.stdout.write(JSON.stringify(createHandshake()) + '\n');
    return;
  }
  if (input.action === 'accept') {
    process.stdout.write(JSON.stringify({
      ssk_base64: acceptSsk(input.private_key_base64, input.encrypted_ssk_base64),
    }) + '\n');
    return;
  }
  throw new Error('action must be create or accept');
}

if (require.main === module) main();

module.exports = {
  SERVER_PUBLIC_KEY,
  createHandshake,
  acceptSsk,
  privateKeyFromRaw,
  publicKeyFromRaw,
};
