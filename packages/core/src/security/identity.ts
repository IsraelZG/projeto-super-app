import { ed25519 } from '@noble/curves/ed25519.js';
import { WORDLIST } from './wordlist.js';
import { toBase64, fromBase64 } from './utils.js';

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  salt: string;
}

/**
 * Converte um Uint8Array para uma string de bits binários (ex: "01001011...").
 */
function bytesToBinary(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += bytes[i].toString(2).padStart(8, '0');
  }
  return bin;
}

/**
 * Gera um mnemônico BIP39 aleatório (12 ou 24 palavras).
 * @param strength Força em bits (128 para 12 palavras, 256 para 24 palavras).
 */
export async function generateMnemonic(strength: 128 | 256 = 128): Promise<string> {
  if (strength !== 128 && strength !== 256) {
    throw new Error("A força do mnemônico deve ser 128 ou 256 bits.");
  }

  const entropy = globalThis.crypto.getRandomValues(new Uint8Array(strength / 8));
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", entropy);
  const hashBytes = new Uint8Array(hashBuffer);

  const checksumLength = strength / 32;
  const entropyBits = bytesToBinary(entropy);
  const checksumBits = bytesToBinary(hashBytes).slice(0, checksumLength);
  const allBits = entropyBits + checksumBits;

  const words: string[] = [];
  for (let i = 0; i < allBits.length; i += 11) {
    const bitGroup = allBits.slice(i, i + 11);
    const index = parseInt(bitGroup, 2);
    words.push(WORDLIST[index]);
  }

  return words.join(" ");
}

/**
 * Valida se um mnemônico BIP39 possui formato e checksum corretos.
 */
export async function validateMnemonic(mnemonic: string): Promise<boolean> {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) {
    return false;
  }

  const indices: number[] = [];
  for (const word of words) {
    const index = WORDLIST.indexOf(word);
    if (index === -1) return false;
    indices.push(index);
  }

  let allBits = "";
  for (const index of indices) {
    allBits += index.toString(2).padStart(11, '0');
  }

  const ent = Math.floor(allBits.length * 32 / 33);
  const checksumLength = allBits.length - ent;
  const entropyBits = allBits.slice(0, ent);
  const checksumBits = allBits.slice(ent);

  const entropyBytes = new Uint8Array(ent / 8);
  for (let i = 0; i < entropyBytes.length; i++) {
    entropyBytes[i] = parseInt(entropyBits.slice(i * 8, (i + 1) * 8), 2);
  }

  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", entropyBytes);
  const hashBytes = new Uint8Array(hashBuffer);
  const expectedChecksumBits = bytesToBinary(hashBytes).slice(0, checksumLength);

  return checksumBits === expectedChecksumBits;
}

/**
 * Deriva a semente binária BIP39 (64 bytes) a partir do mnemônico e uma passphrase opcional.
 */
export async function deriveSeed(mnemonic: string, passphrase = ""): Promise<Uint8Array> {
  const isValid = await validateMnemonic(mnemonic);
  if (!isValid) {
    throw new Error("Mnemônico inválido para derivação de semente.");
  }

  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(mnemonic),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const salt = new TextEncoder().encode("mnemonic" + passphrase);
  const seedBuffer = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 2048,
      hash: "SHA-512"
    },
    keyMaterial,
    512 // 512 bits = 64 bytes
  );

  return new Uint8Array(seedBuffer);
}

/**
 * Deriva um par de chaves Ed25519 determinístico a partir de um mnemônico BIP39.
 */
export async function deriveKeyPairFromMnemonic(
  mnemonic: string, 
  passphrase = ""
): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  const seed = await deriveSeed(mnemonic, passphrase);
  // Usa os primeiros 32 bytes do seed como chave privada de entropia Ed25519
  const privateKey = seed.slice(0, 32);
  const publicKey = ed25519.getPublicKey(privateKey);

  return { publicKey, privateKey };
}

/**
 * Cifra um segredo em formato de texto usando a senha fornecida via PBKDF2 e AES-256-GCM.
 */
export async function encryptSecret(secretText: string, password: string): Promise<EncryptedSecret> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const passwordKey = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const aesKey = await globalThis.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    new TextEncoder().encode(secretText)
  );

  return {
    ciphertext: toBase64(new Uint8Array(ciphertextBuffer)),
    iv: toBase64(iv),
    salt: toBase64(salt)
  };
}

/**
 * Decifra um segredo criptografado usando a senha fornecida.
 */
export async function decryptSecret(encrypted: EncryptedSecret, password: string): Promise<string> {
  const salt = fromBase64(encrypted.salt);
  const iv = fromBase64(encrypted.iv);
  const ciphertext = fromBase64(encrypted.ciphertext);

  const passwordKey = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const aesKey = await globalThis.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ciphertext
  );

  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * Assina uma mensagem usando a chave privada Ed25519.
 */
export function signMessage(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

/**
 * Verifica a assinatura de uma mensagem usando a chave pública Ed25519.
 */
export function verifyMessage(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  return ed25519.verify(signature, message, publicKey);
}
