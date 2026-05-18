import { useEffect, useState } from 'react';
import * as Comlink from 'comlink';
import type { SyncWorkerAPI } from '../worker/sync-worker';
import { createSuperAppStore } from '../store/tinybase';
import type { Store } from 'tinybase';
import { WebRTCManager } from '../worker/network/webrtc-manager';
import { logger } from '../core/logger';

export interface SyncState {
  isReady: boolean;
  store: Store | null;
  workerApi: Comlink.Remote<typeof SyncWorkerAPI> | null;
  webrtc: WebRTCManager | null;
}

export function useSyncWorker(peerName: string | null): SyncState {
  const [state, setState] = useState<SyncState>({
    isReady: false,
    store: null,
    workerApi: null,
    webrtc: null,
  });

  useEffect(() => {
    if (!peerName) return; // Wait for name

    let worker: Worker;
    let persister: any;
    let webrtcInstance: WebRTCManager | null = null;

    async function init() {
      try {
        // Initialize Network P2P Stack on the Main Thread
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsHost = window.location.hostname || 'localhost';
        webrtcInstance = new WebRTCManager(`${wsProtocol}//${wsHost}:3000/ws`, peerName || undefined);
        webrtcInstance.connect();

        // Create the MessageChannel to bridge between Main Thread & Web Worker
        const channel = new MessageChannel();

        channel.port2.onmessage = (event) => {
          const data = event.data;
          if (data.type === 'broadcast') {
            webrtcInstance?.broadcast(data.topic, data.message);
          } else if (data.type === 'joinTopic') {
            webrtcInstance?.joinTopic(data.topic);
          }
        };

        webrtcInstance.setOnMessage((peerId, topic, message) => {
          channel.port2.postMessage({ type: 'message', peerId, topic, message });
        });

        webrtcInstance.setOnConnection((peerId) => {
          channel.port2.postMessage({ type: 'connection', peerId });
        });

        // Instantiate Worker
        worker = new Worker(new URL('../worker/sync-worker.ts', import.meta.url), { type: 'module' });
        const workerApi = Comlink.wrap<typeof SyncWorkerAPI>(worker);
        
        // Initialize SQLite in OPFS and pass port1 to worker
        await workerApi.init(
          'superapp_prod.sqlite', 
          peerName || undefined, 
          Comlink.transfer(channel.port1, [channel.port1])
        );
        
        // Setup TinyBase Store
        const { store, persister: p } = createSuperAppStore(workerApi);
        persister = p;
        await persister.startAutoLoad();

        setState({ isReady: true, store, workerApi, webrtc: webrtcInstance });
      } catch (err) {
        logger.error('UI', "Failed to initialize Sync Worker:", err);
      }
    }

    init();

    return () => {
      if (persister) persister.destroy();
      if (worker) worker.terminate();
    };
  }, [peerName]);

  return state;
}

