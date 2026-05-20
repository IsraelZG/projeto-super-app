import { describe, it, expect } from 'vitest';
import {
  generateMnemonic,
  validateMnemonic,
  deriveKeyPairFromMnemonic,
  encryptSecret,
  decryptSecret,
  signMessage,
  verifyMessage,
  toBase64,
  fromBase64
} from './identity.js';

describe('Infraestrutura de Identidade & Criptografia (BIP39, Ed25519, PBKDF2/AES)', () => {
  
  describe('BIP39 Mnemonic', () => {
    it('deve gerar mnemônico de 12 palavras (128 bits de entropia) por padrão', async () => {
      const mnemonic = await generateMnemonic(128);
      expect(mnemonic.split(/\s+/)).toHaveLength(12);
      expect(await validateMnemonic(mnemonic)).toBe(true);
    });

    it('deve gerar mnemônico de 24 palavras (256 bits de entropia) se solicitado', async () => {
      const mnemonic = await generateMnemonic(256);
      expect(mnemonic.split(/\s+/)).toHaveLength(24);
      expect(await validateMnemonic(mnemonic)).toBe(true);
    });

    it('deve falhar na validação de mnemônico com palavras inválidas', async () => {
      const invalid = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon invalidword";
      expect(await validateMnemonic(invalid)).toBe(false);
    });

    it('deve falhar na validação de mnemônico com checksum corrompido', async () => {
      // 11 "abandon" + 1 "about" tem checksum correto (o último é o checksum válido da entropia zero)
      const valid = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
      expect(await validateMnemonic(valid)).toBe(true);

      // Altera a primeira palavra, mantendo as palavras no dicionário, mas quebrando o checksum
      const badChecksum = "ability abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
      expect(await validateMnemonic(badChecksum)).toBe(false);
    });

    it('deve falhar com mnemônicos de tamanhos incorretos', async () => {
      const short = "abandon abandon abandon";
      expect(await validateMnemonic(short)).toBe(false);
    });
  });

  describe('Ed25519 Derivation and Signing', () => {
    it('deve derivar chaves deterministicamente a partir do mnemônico', async () => {
      const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
      
      const pair1 = await deriveKeyPairFromMnemonic(mnemonic);
      const pair2 = await deriveKeyPairFromMnemonic(mnemonic);

      expect(pair1.privateKey).toEqual(pair2.privateKey);
      expect(pair1.publicKey).toEqual(pair2.publicKey);
      expect(pair1.privateKey).toHaveLength(32);
      expect(pair1.publicKey).toHaveLength(32);

      // Com passphrase diferente deve derivar chaves diferentes
      const pairWithPass = await deriveKeyPairFromMnemonic(mnemonic, "minha-senha-extra");
      expect(pairWithPass.publicKey).not.toEqual(pair1.publicKey);
    });

    it('deve assinar e verificar mensagens com sucesso', async () => {
      const mnemonic = await generateMnemonic(128);
      const { publicKey, privateKey } = await deriveKeyPairFromMnemonic(mnemonic);
      
      const message = new TextEncoder().encode("Olá, Superapp P2P!");
      const signature = signMessage(privateKey, message);
      
      expect(signature).toHaveLength(64);
      expect(verifyMessage(publicKey, message, signature)).toBe(true);

      // Mensagem modificada deve falhar na verificação
      const modifiedMessage = new TextEncoder().encode("Olá, Superapp P2P! Modificado");
      expect(verifyMessage(publicKey, modifiedMessage, signature)).toBe(false);

      // Chave pública diferente deve falhar na verificação
      const otherPair = await deriveKeyPairFromMnemonic(await generateMnemonic(128));
      expect(verifyMessage(otherPair.publicKey, message, signature)).toBe(false);
    });
  });

  describe('Password-based Secret Encryption (PBKDF2 + AES-GCM)', () => {
    it('deve cifrar e decifrar um texto com sucesso usando a senha correta', async () => {
      const secret = "Esta é minha frase semente secreta BIP39.";
      const password = "SenhaSuperSegura123!";

      const encrypted = await encryptSecret(secret, password);
      
      expect(encrypted.ciphertext).toBeTypeOf('string');
      expect(encrypted.iv).toBeTypeOf('string');
      expect(encrypted.salt).toBeTypeOf('string');

      const decrypted = await decryptSecret(encrypted, password);
      expect(decrypted).toBe(secret);
    });

    it('deve falhar ao tentar decifrar com a senha incorreta', async () => {
      const secret = "Segredo";
      const password = "SenhaCorreta";
      
      const encrypted = await encryptSecret(secret, password);
      
      await expect(decryptSecret(encrypted, "SenhaIncorreta")).rejects.toThrow();
    });

    it('deve gerar sais e IVs diferentes para o mesmo segredo cifrado repetidamente', async () => {
      const secret = "Mesmo Segredo";
      const password = "Senha";

      const enc1 = await encryptSecret(secret, password);
      const enc2 = await encryptSecret(secret, password);

      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
      expect(enc1.iv).not.toBe(enc2.iv);
      expect(enc1.salt).not.toBe(enc2.salt);
    });
  });

  describe('Base64 Utilities', () => {
    it('deve converter bytes para base64 e vice-versa corretamente', () => {
      const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
      const base64 = toBase64(bytes);
      const reconstructed = fromBase64(base64);
      expect(reconstructed).toEqual(bytes);
    });
  });
});
