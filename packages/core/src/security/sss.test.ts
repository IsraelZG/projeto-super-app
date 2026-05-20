import { describe, it, expect } from 'vitest';
import { splitSecret, combineSecrets, Shard } from './sss.js';

describe("Shamir's Secret Sharing (SSS) GF(2^8)", () => {
  it("deve dividir e reconstruir um segredo com sucesso (limiar 2-de-3)", () => {
    const secret = new TextEncoder().encode("SegredoSuperSecreto123");
    
    // Divide em 3 fragmentos, precisando de 2 para recuperar
    const shards = splitSecret(secret, 2, 3);
    expect(shards).toHaveLength(3);
    
    // Verifica que cada shard possui o tamanho esperado e IDs de 1 a 3
    shards.forEach((shard, idx) => {
      expect(shard.id).toBe(idx + 1);
      expect(shard.data).toHaveLength(secret.length);
    });

    // Combina os shards 1 e 2
    const reconstructed12 = combineSecrets([shards[0], shards[1]]);
    expect(reconstructed12).toEqual(secret);

    // Combina os shards 2 e 3
    const reconstructed23 = combineSecrets([shards[1], shards[2]]);
    expect(reconstructed23).toEqual(secret);

    // Combina os shards 1 e 3
    const reconstructed13 = combineSecrets([shards[0], shards[2]]);
    expect(reconstructed13).toEqual(secret);

    // Combina todos os 3 shards (quórum excedido, deve funcionar)
    const reconstructedAll = combineSecrets(shards);
    expect(reconstructedAll).toEqual(secret);
  });

  it("deve dividir e reconstruir com limiares maiores (ex: 3-de-5, 5-of-10)", () => {
    const secret = new TextEncoder().encode("OutroSegredoCriptografico");
    
    // Cenário 3-de-5
    const shards5 = splitSecret(secret, 3, 5);
    
    // 3 fragmentos quaisquer devem reconstruir
    expect(combineSecrets([shards5[0], shards5[2], shards5[4]])).toEqual(secret);
    expect(combineSecrets([shards5[1], shards5[2], shards5[3]])).toEqual(secret);

    // Cenário 5-de-10
    const shards10 = splitSecret(secret, 5, 10);
    
    // 5 fragmentos quaisquer devem reconstruir
    const subset = [shards10[0], shards10[2], shards10[4], shards10[6], shards10[8]];
    expect(combineSecrets(subset)).toEqual(secret);
  });

  it("deve falhar ao tentar reconstruir com menos fragmentos que o limiar K", () => {
    const secret = new TextEncoder().encode("SegredoImpossivel");
    const K = 3;
    const N = 5;
    
    const shards = splitSecret(secret, K, N);

    // Tentar combinar apenas 2 fragmentos (requer 3)
    const incomplete = [shards[0], shards[1]];
    const badSecret = combineSecrets(incomplete);

    // Matematicamente, a reconstrução com menos pontos dará uma resposta incorreta (ou seja, não reconstrói o original)
    expect(badSecret).not.toEqual(secret);
  });

  it("deve rejeitar parâmetros inválidos de divisão", () => {
    const secret = new Uint8Array([1, 2, 3]);

    // K < 2
    expect(() => splitSecret(secret, 1, 3)).toThrow();
    // K > N
    expect(() => splitSecret(secret, 4, 3)).toThrow();
    // N > 255
    expect(() => splitSecret(secret, 3, 256)).toThrow();
  });

  it("deve lançar erro se tentar combinar menos de 2 fragmentos", () => {
    const shard: Shard = { id: 1, data: new Uint8Array([1, 2, 3]) };
    expect(() => combineSecrets([shard])).toThrow();
    expect(() => combineSecrets([])).toThrow();
  });

  it("deve lançar erro se os fragmentos tiverem tamanhos de dados diferentes", () => {
    const shard1: Shard = { id: 1, data: new Uint8Array([1, 2, 3]) };
    const shard2: Shard = { id: 2, data: new Uint8Array([1, 2]) };
    expect(() => combineSecrets([shard1, shard2])).toThrow();
  });

  it("deve suportar divisão e reconstrução de dados binários arbitrários (0x00 a 0xFF)", () => {
    const binaryData = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      binaryData[i] = i;
    }

    const shards = splitSecret(binaryData, 4, 6);
    const recovered = combineSecrets([shards[1], shards[3], shards[4], shards[5]]);
    expect(recovered).toEqual(binaryData);
  });
});
