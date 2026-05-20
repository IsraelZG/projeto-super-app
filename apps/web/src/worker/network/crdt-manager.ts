import * as Y from 'yjs';

type RemoteDataCallback = (topic: string, nodes: any[], edges: any[]) => void;

export interface NetworkBridge {
  setOnMessage(handler: (peerId: string, topic: string, message: Uint8Array) => void): void;
  setOnConnection(handler: (peerId: string) => void): void;
  broadcast(topic: string, message: Uint8Array): void;
  joinTopic(topic: string): void;
}

export class CRDTManager {
  private docs: Map<string, Y.Doc> = new Map();
  private onRemoteData: RemoteDataCallback | null = null;
  private network: NetworkBridge;
  private persistence: any;

  constructor(network: NetworkBridge, persistence?: any) {
    this.network = network;
    this.persistence = persistence || null;
    this.network.setOnMessage((peerId, topic, message) => {
      this.handleIncomingMessage(peerId, topic, message);
    });
    this.network.setOnConnection((peerId) => {
      // Sync state for all joined docs
      for (const topic of this.docs.keys()) {
        this.syncState(peerId, topic);
      }
    });
  }

  public setOnRemoteData(callback: RemoteDataCallback) {
    this.onRemoteData = callback;
  }

  public joinContext(topic: string) {
    if (!this.docs.has(topic)) {
      const doc = new Y.Doc();
      this.docs.set(topic, doc);
      
      // When local map changes, encode and broadcast
      let sessionUpdatesCount = 0;
      doc.on('update', (update: Uint8Array, origin: any) => {
        if (origin === 'load-origin') return;

        if (origin !== this) {
          // It was a local mutation, broadcast it!
          const packet = new Uint8Array(1 + update.length);
          packet[0] = 0; // type 0 = update
          packet.set(update, 1);
          this.network.broadcast(topic, packet);
        }

        if (this.persistence) {
          this.persistence.saveUpdate(topic, update).catch((err: any) => {
            console.error('CRDT: Failed to save update:', err);
          });
          sessionUpdatesCount++;
          if (sessionUpdatesCount >= 50) {
            sessionUpdatesCount = 0;
            this.compactSnapshot(topic).catch((err: any) => {
              console.error('CRDT: Compaction failed:', err);
            });
          }
        }
      });

      // Observe nodes Map
      const nodesMap = doc.getMap('nodes');
      nodesMap.observe((event, transaction) => {
        if (transaction.origin === this && this.onRemoteData) {
          const mutations: any[] = [];
          event.changes.keys.forEach((change, key) => {
            if (change.action === 'add' || change.action === 'update') {
              const val: any = nodesMap.get(key);
              const nodeObj = val instanceof Y.Map ? val.toJSON() : val;
              mutations.push(nodeObj);
            }
          });
          if (mutations.length > 0) {
            this.onRemoteData(topic, mutations, []);
          }
        }
      });

      // Observe edges Map
      const edgesMap = doc.getMap('edges');
      edgesMap.observe((event, transaction) => {
        if (transaction.origin === this && this.onRemoteData) {
          const mutations: any[] = [];
          event.changes.keys.forEach((change, key) => {
            if (change.action === 'add' || change.action === 'update') {
              const val: any = edgesMap.get(key);
              const edgeObj = val instanceof Y.Map ? val.toJSON() : val;
              mutations.push(edgeObj);
            }
          });
          if (mutations.length > 0) {
            this.onRemoteData(topic, [], mutations);
          }
        }
      });

      if (this.persistence) {
        this.loadPersistedState(topic).catch((err) => {
          console.error('CRDT: Failed to load persisted state:', err);
        });
      }
      
      this.network.joinTopic(topic);
    }
  }

  public hydrate(topic: string, nodes: any[], edges: any[]) {
    this.joinContext(topic);
    const doc = this.docs.get(topic)!;

    doc.transact(() => {
      const nodesMap = doc.getMap('nodes');
      for (const node of nodes) {
        if (!nodesMap.has(node.id)) {
          nodesMap.set(node.id, node);
        }
      }

      const edgesMap = doc.getMap('edges');
      for (const edge of edges) {
        if (!edgesMap.has(edge.id)) {
          edgesMap.set(edge.id, edge);
        }
      }
    }, this); // Origin = `this` to prevent redundant broadcasts
  }

  public syncState(_peerId: string, topic: string) {
    const doc = this.docs.get(topic);
    if (!doc) return;

    // Send our state vector so the peer can reply with missing updates
    const sv = Y.encodeStateVector(doc);
    const packet = new Uint8Array(1 + sv.length);
    packet[0] = 1; // type 1 = stateVector
    packet.set(sv, 1);
    
    this.network.broadcast(topic, packet);
  }

  public injectLocalNode(topic: string, nodeData: any) {
    this.joinContext(topic);
    const doc = this.docs.get(topic)!;
    const nodesMap = doc.getMap('nodes');
    nodesMap.set(nodeData.id, nodeData);
  }

  public injectLocalEdge(topic: string, edgeData: any) {
    this.joinContext(topic);
    const doc = this.docs.get(topic)!;
    const edgesMap = doc.getMap('edges');
    edgesMap.set(edgeData.id, edgeData);
  }

  private handleIncomingMessage(_peerId: string, topic: string, message: Uint8Array) {
    this.joinContext(topic);
    const doc = this.docs.get(topic)!;

    const type = message[0];
    const payload = message.slice(1);

    if (type === 0) {
      // It's an update, apply it!
      // Pass `this` as origin so the observers know it's remote
      Y.applyUpdate(doc, payload, this);
    } 
    else if (type === 1) {
      // It's a state vector, peer is asking for missing updates
      const stateVector = payload;
      const update = Y.encodeStateAsUpdate(doc, stateVector);
      
      // Reply with the update if it has data
      if (update.length > 2) {
        const packet = new Uint8Array(1 + update.length);
        packet[0] = 0;
        packet.set(update, 1);
        this.network.broadcast(topic, packet); 
      }
    }
  }

  private async loadPersistedState(topic: string) {
    const doc = this.docs.get(topic);
    if (!doc) return;

    try {
      const snapshot = await this.persistence.loadSnapshot(topic);
      if (snapshot && snapshot.bin) {
        Y.applyUpdate(doc, snapshot.bin, 'load-origin');
      }

      const updates = await this.persistence.loadUpdates(topic);
      for (const update of updates) {
        Y.applyUpdate(doc, update, 'load-origin');
      }
      console.log(`CRDT: Successfully loaded state for room ${topic} from database.`);
    } catch (err) {
      console.error(`CRDT: Failed to load state for room ${topic}:`, err);
    }
  }

  public async compactSnapshot(topic: string) {
    const doc = this.docs.get(topic);
    if (!doc) return;

    try {
      const state = Y.encodeStateAsUpdate(doc);
      const sv = Y.encodeStateVector(doc);
      
      await this.persistence.saveSnapshot(topic, state, sv);
      await this.persistence.clearUpdates(topic);
      console.log(`CRDT: Compacted snapshot for room ${topic}`);
    } catch (err) {
      console.error(`CRDT: Failed to compact snapshot for room ${topic}:`, err);
    }
  }
}

