import { describe, it, expect } from 'vitest';
import { 
  encryptPayload, 
  decryptPayload, 
  encryptJson, 
  decryptJson, 
  deriveEpochKey 
} from './encryption.js';

describe('Cifragem Simétrica por Épocas (AES-256-GCM + HKDF)', () => {
  const masterKey = new Uint8Array(32);
  globalThis.crypto.getRandomValues(masterKey);

  describe('Derivação de Chaves de Época via HKDF', () => {
    it('deve derivar chaves deterministicamente a partir da chave mestre e época', async () => {
      const keyEpoch1_A = await deriveEpochKey(masterKey, 1);
      const keyEpoch1_B = await deriveEpochKey(masterKey, 1);
      
      expect(keyEpoch1_A).toHaveLength(32);
      expect(keyEpoch1_A).toEqual(keyEpoch1_B);

      // Épocas diferentes devem produzir chaves diferentes
      const keyEpoch2 = await deriveEpochKey(masterKey, 2);
      expect(keyEpoch1_A).not.toEqual(keyEpoch2);
    });

    it('deve derivar chaves diferentes a partir de chaves mestres diferentes', async () => {
      const otherMaster = new Uint8Array(32);
      globalThis.crypto.getRandomValues(otherMaster);

      const keyA = await deriveEpochKey(masterKey, 1);
      const keyB = await deriveEpochKey(otherMaster, 1);

      expect(keyA).not.toEqual(keyB);
    });
  });

  describe('Cifragem / Decifragem de Payload Binário', () => {
    it('deve cifrar e decifrar com sucesso usando chaves de época derivadas', async () => {
      const key = await deriveEpochKey(masterKey, 5);
      const originalPayload = new TextEncoder().encode("Dados confidenciais da timeline");

      const { ciphertext, iv } = await encryptPayload(originalPayload, key);
      
      expect(iv).toHaveLength(12);
      expect(ciphertext).not.toEqual(originalPayload);

      const decrypted = await decryptPayload(ciphertext, key, iv);
      expect(decrypted).toEqual(originalPayload);
    });

    it('deve falhar na decifragem se a chave ou IV estiver incorreto', async () => {
      const key1 = await deriveEpochKey(masterKey, 1);
      const key2 = await deriveEpochKey(masterKey, 2);
      const originalPayload = new TextEncoder().encode("Mensagem secreta");

      const { ciphertext, iv } = await encryptPayload(originalPayload, key1);

      // Decifrar com chave errada deve falhar
      await expect(decryptPayload(ciphertext, key2, iv)).rejects.toThrow();

      // Decifrar com IV modificado deve falhar
      const corruptedIv = new Uint8Array(iv);
      corruptedIv[0] ^= 1;
      await expect(decryptPayload(ciphertext, key1, corruptedIv)).rejects.toThrow();
    });
  });

  describe('Cifragem / Decifragem de JSON', () => {
    it('deve cifrar e decifrar um objeto JSON mantendo sua integridade', async () => {
      const key = await deriveEpochKey(masterKey, 12);
      const data = {
        id: "node-123",
        text: "Olá mundo criptografado",
        number: 42,
        nested: { active: true }
      };

      const { ciphertext, iv } = await encryptJson(data, key);
      const decryptedData = await decryptJson(ciphertext, key, iv);

      expect(decryptedData).toEqual(data);
      expect(decryptedData.nested.active).toBe(true);
    });
  });
});
