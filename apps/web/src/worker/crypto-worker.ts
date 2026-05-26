import * as Comlink from 'comlink';
import {
  generateMnemonic,
  validateMnemonic,
  deriveKeyPairFromMnemonic,
  encryptSecret,
  decryptSecret
} from '@superapp/core/src/security/identity.js';
import { splitSecret, combineSecrets } from '@superapp/core/src/security/sss.js';
import { toBase64, fromBase64 } from '@superapp/core/src/security/utils.js';

export const CryptoWorkerAPI = {
  async generateMnemonic(strength: 128 | 256 = 128): Promise<string> {
    return generateMnemonic(strength);
  },

  async validateMnemonic(mnemonic: string): Promise<boolean> {
    return validateMnemonic(mnemonic);
  },

  async deriveKeyPair(mnemonic: string, passphrase = ""): Promise<{ publicKey: string; privateKey: string }> {
    const { publicKey, privateKey } = await deriveKeyPairFromMnemonic(mnemonic, passphrase);
    return {
      publicKey: toBase64(publicKey),
      privateKey: toBase64(privateKey)
    };
  },

  async encryptSecret(secretText: string, password: string) {
    return encryptSecret(secretText, password);
  },

  async decryptSecret(encrypted: any, password: string): Promise<string> {
    return decryptSecret(encrypted, password);
  },

  async splitSecret(secretText: string, threshold: number, numShards: number) {
    const secretBytes = new TextEncoder().encode(secretText);
    const shards = splitSecret(secretBytes, threshold, numShards);
    return shards.map(shard => ({
      id: shard.id,
      data: toBase64(shard.data)
    }));
  },

  async combineSecrets(shards: Array<{ id: number; data: string }>): Promise<string> {
    const sssShards = shards.map(s => ({
      id: s.id,
      data: fromBase64(s.data)
    }));
    const secretBytes = combineSecrets(sssShards);
    return new TextDecoder().decode(secretBytes);
  }
};

Comlink.expose(CryptoWorkerAPI);
export type CryptoWorkerType = typeof CryptoWorkerAPI;
