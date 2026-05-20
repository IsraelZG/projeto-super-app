export interface Shard {
  id: number; // Identificador do fragmento (1 a 255)
  data: Uint8Array; // Dados do fragmento
}

// Tabelas de Log e Exponencial em GF(2^8) usando o polinômio primitivo x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

let val = 1;
for (let i = 0; i < 255; i++) {
  EXP[i] = val;
  LOG[val] = i;
  val <<= 1;
  if (val & 0x100) {
    val ^= 0x11d;
  }
}
for (let i = 255; i < 512; i++) {
  EXP[i] = EXP[i - 255];
}

/**
 * Soma (e subtração) em GF(2^8) - é equivalente ao XOR binário.
 */
function gfAdd(a: number, b: number): number {
  return a ^ b;
}

/**
 * Multiplicação em GF(2^8) usando tabelas de logs.
 */
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/**
 * Divisão em GF(2^8) usando tabelas de logs.
 */
function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error("Divisão por zero em GF(2^8)");
  if (a === 0) return 0;
  let diff = LOG[a] - LOG[b];
  if (diff < 0) diff += 255;
  return EXP[diff];
}

/**
 * Avalia um polinômio com coeficientes especificados em x usando o método de Horner.
 */
function evalPoly(coeff: Uint8Array, x: number): number {
  let result = 0;
  for (let i = coeff.length - 1; i >= 0; i--) {
    result = gfAdd(gfMul(result, x), coeff[i]);
  }
  return result;
}

/**
 * Divide um segredo em N fragmentos (shards) com limiar K de reconstrução (esquema K-de-N de Shamir).
 * @param secret O segredo original como Uint8Array
 * @param threshold Limiar K (quórum mínimo necessário para reconstruir)
 * @param numShards Número total de fragmentos N a gerar (2 <= K <= N <= 255)
 */
export function splitSecret(secret: Uint8Array, threshold: number, numShards: number): Shard[] {
  if (threshold < 2 || threshold > numShards || numShards > 255) {
    throw new Error("Parâmetros inválidos para Shamir's Secret Sharing (requer: 2 <= K <= N <= 255).");
  }

  const shards: Shard[] = Array.from({ length: numShards }, (_, index) => ({
    id: index + 1,
    data: new Uint8Array(secret.length)
  }));

  // Coeficientes temporários para o polinômio: coeff[0] é o segredo, os demais [1..K-1] são aleatórios.
  const coeff = new Uint8Array(threshold);

  for (let i = 0; i < secret.length; i++) {
    coeff[0] = secret[i];
    // Gera K - 1 coeficientes aleatórios não-nulos
    const randomVals = globalThis.crypto.getRandomValues(new Uint8Array(threshold - 1));
    for (let c = 1; c < threshold; c++) {
      // Coeficientes em GF(2^8) podem ser de 0 a 255
      coeff[c] = randomVals[c - 1];
    }

    // Avalia o polinômio em x = 1 até N para cada fragmento
    for (let s = 0; s < numShards; s++) {
      const x = shards[s].id; // x é 1, 2, ..., N
      shards[s].data[i] = evalPoly(coeff, x);
    }
  }

  return shards;
}

/**
 * Reconstrói o segredo original combinando um conjunto de fragmentos (mínimo K shards).
 * Usa interpolação de Lagrange em GF(2^8) calculando o valor em x = 0.
 * @param shards Array contendo os fragmentos de Shamir recuperados
 */
export function combineSecrets(shards: Shard[]): Uint8Array {
  if (shards.length < 2) {
    throw new Error("São necessários ao menos 2 fragmentos para a reconstrução.");
  }

  const secretLength = shards[0].data.length;
  for (let s = 1; s < shards.length; s++) {
    if (shards[s].data.length !== secretLength) {
      throw new Error("Todos os fragmentos devem possuir o mesmo tamanho de dados.");
    }
  }

  const secret = new Uint8Array(secretLength);

  // Calcula Lagrange em x = 0 para cada byte do segredo
  for (let i = 0; i < secretLength; i++) {
    let secretByte = 0;

    for (let j = 0; j < shards.length; j++) {
      let num = 1;
      let den = 1;

      for (let m = 0; m < shards.length; m++) {
        if (m === j) continue;
        num = gfMul(num, shards[m].id); // x_m
        den = gfMul(den, gfAdd(shards[j].id, shards[m].id)); // x_j ^ x_m (subtração em GF(2^8))
      }

      const lagrangeCoeff = gfDiv(num, den);
      secretByte = gfAdd(secretByte, gfMul(shards[j].data[i], lagrangeCoeff));
    }

    secret[i] = secretByte;
  }

  return secret;
}
