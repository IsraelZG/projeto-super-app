import { useEffect, useState } from 'react';
import * as Comlink from 'comlink';
import type { CryptoWorkerType } from '../worker/crypto-worker';

let cryptoWorkerInstance: Worker | null = null;
let cryptoApiInstance: Comlink.Remote<CryptoWorkerType> | null = null;

export function getCryptoApi(): Comlink.Remote<CryptoWorkerType> {
  if (!cryptoApiInstance) {
    cryptoWorkerInstance = new Worker(
      new URL('../worker/crypto-worker.ts', import.meta.url),
      { type: 'module' }
    );
    cryptoApiInstance = Comlink.wrap<CryptoWorkerType>(cryptoWorkerInstance);
  }
  return cryptoApiInstance;
}

export function useCrypto() {
  return getCryptoApi();
}
