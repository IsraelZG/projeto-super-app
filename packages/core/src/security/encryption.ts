/**
 * Cifra um payload binário usando AES-256-GCM com a chave fornecida.
 * Gera um IV aleatório de 12 bytes.
 */
export async function encryptPayload(
  payloadBytes: Uint8Array, 
  keyBytes: Uint8Array
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  if (keyBytes.length !== 32) {
    throw new Error("A chave AES-256-GCM deve possuir exatamente 32 bytes (256 bits).");
  }

  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  
  const aesKey = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes as any,
    "AES-GCM",
    false,
    ["encrypt"]
  );

  const ciphertextBuffer = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as any },
    aesKey,
    payloadBytes as any
  );

  return {
    ciphertext: new Uint8Array(ciphertextBuffer),
    iv
  };
}

/**
 * Decifra um payload binário usando AES-256-GCM com a chave e IV fornecidos.
 */
export async function decryptPayload(
  ciphertextBytes: Uint8Array, 
  keyBytes: Uint8Array, 
  ivBytes: Uint8Array
): Promise<Uint8Array> {
  if (keyBytes.length !== 32) {
    throw new Error("A chave AES-256-GCM deve possuir exatamente 32 bytes (256 bits).");
  }

  const aesKey = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes as any,
    "AES-GCM",
    false,
    ["decrypt"]
  );

  const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes as any },
    aesKey,
    ciphertextBytes as any
  );

  return new Uint8Array(decryptedBuffer);
}

/**
 * Cifra um objeto JSON convertendo-o para string UTF-8.
 */
export async function encryptJson(
  data: any, 
  keyBytes: Uint8Array
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const jsonString = JSON.stringify(data);
  const payloadBytes = new TextEncoder().encode(jsonString);
  return encryptPayload(payloadBytes, keyBytes);
}

/**
 * Decifra um payload e reconstrói o objeto JSON original.
 */
export async function decryptJson(
  ciphertextBytes: Uint8Array, 
  keyBytes: Uint8Array, 
  ivBytes: Uint8Array
): Promise<any> {
  const decryptedBytes = await decryptPayload(ciphertextBytes, keyBytes, ivBytes);
  const jsonString = new TextDecoder().decode(decryptedBytes);
  return JSON.parse(jsonString);
}

/**
 * Deriva uma chave simétrica de 256 bits para uma época específica a partir de uma chave-mestre.
 * Utiliza o algoritmo padrão HKDF-SHA-256.
 * @param masterKey A chave mestre como Uint8Array (mínimo 32 bytes)
 * @param epoch O índice da época (inteiro)
 */
export async function deriveEpochKey(masterKey: Uint8Array, epoch: number): Promise<Uint8Array> {
  const importedMaster = await globalThis.crypto.subtle.importKey(
    "raw",
    masterKey as any,
    "HKDF",
    false,
    ["deriveBits"]
  );

  const info = new TextEncoder().encode(`epoch-${epoch}`);
  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0), // salt vazio conforme RFC 5869
      info
    },
    importedMaster,
    256 // 256 bits = 32 bytes
  );

  return new Uint8Array(derivedBits);
}
