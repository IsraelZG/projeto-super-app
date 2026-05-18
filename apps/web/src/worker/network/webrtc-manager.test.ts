import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebRTCManager } from './webrtc-manager';
import { logger } from '../../core/logger';

// ----------------------------------------------------
// Mock browser APIs since they are absent in Node
// ----------------------------------------------------

class MockWebSocket {
  public readyState: number = 0; // CONNECTING
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public url: string;

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 0);
  }

  public send(_msg: string) {}
  public close() {}
}

class MockRTCDataChannel {
  public readyState: string = 'connecting';
  public binaryType: string = 'blob';
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: ((err: any) => void) | null = null;
  public onmessage: ((event: { data: any }) => void) | null = null;

  public send(_data: any) {}
  
  public close() {
    this.readyState = 'closed';
    if (this.onclose) this.onclose();
  }

  public triggerOpen() {
    this.readyState = 'open';
    if (this.onopen) this.onopen();
  }
}

class MockRTCPeerConnection {
  public connectionState: string = 'new';
  public localDescription: any = null;
  public remoteDescription: any = null;
  public onicecandidate: ((event: { candidate: any }) => void) | null = null;
  public ondatachannel: ((event: { channel: any }) => void) | null = null;
  public onconnectionstatechange: (() => void) | null = null;
  public config: any;

  constructor(config: any) {
    this.config = config;
  }

  public createOffer() {
    return Promise.resolve({ type: 'offer', sdp: 'mock-sdp-offer' });
  }

  public createAnswer() {
    return Promise.resolve({ type: 'answer', sdp: 'mock-sdp-answer' });
  }

  public setLocalDescription(desc: any) {
    this.localDescription = desc;
    return Promise.resolve();
  }

  public setRemoteDescription(desc: any) {
    this.remoteDescription = desc;
    return Promise.resolve();
  }

  public addIceCandidate() {
    return Promise.resolve();
  }

  public close() {
    this.connectionState = 'closed';
  }

  public createDataChannel(_label: string) {
    return new MockRTCDataChannel();
  }
}

describe('WebRTCManager Resiliência e Testabilidade', () => {
  beforeEach(() => {
    logger.setMinLevel('WARN'); // Avoid polluting console with debug logs during tests
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('deve instanciar com ICE servers dinâmicos parametrizados', () => {
    const customIceServers = [{ urls: 'turn:meu-servidor-turn.com' }];
    const manager = new WebRTCManager('ws://localhost:3000', 'Peer A', customIceServers, MockWebSocket, MockRTCPeerConnection);
    
    expect((manager as any).iceServers).toEqual(customIceServers);
    expect(manager.myPeerName).toBe('Peer A');
  });

  it('deve realizar handshake completo com sucesso', async () => {
    const manager = new WebRTCManager('ws://localhost:3000', 'Peer A', undefined, MockWebSocket, MockRTCPeerConnection);
    
    const createOfferSpy = vi.spyOn(MockRTCPeerConnection.prototype, 'createOffer');
    const setLocalDescSpy = vi.spyOn(MockRTCPeerConnection.prototype, 'setLocalDescription');

    manager.connect();

    // Trigger signaling server mock loading
    await vi.advanceTimersByTimeAsync(1);

    // Simulate PEER_JOINED event from signalling
    const wsInstance = (manager as any).ws as MockWebSocket;
    const wsSendSpy = vi.spyOn(wsInstance, 'send');

    wsInstance.onmessage!({
      data: JSON.stringify({
        type: 'PEER_JOINED',
        peerId: 'peer-b-id',
        peerName: 'Peer B',
        topic: 'sala-teste'
      })
    });

    await vi.advanceTimersByTimeAsync(1);

    expect(createOfferSpy).toHaveBeenCalled();
    expect(setLocalDescSpy).toHaveBeenCalled();
    
    // Signalling must have received the offer message
    expect(wsSendSpy).toHaveBeenCalled();
    const sentSignalingPayload = JSON.parse((wsSendSpy as any).mock.calls[0][0]);
    expect(sentSignalingPayload.type).toBe('WEBRTC_MESSAGE');
    expect(sentSignalingPayload.payload.type).toBe('offer');
  });

  it('deve limpar conexões travadas após 15 segundos (Handshake Timeout)', async () => {
    const manager = new WebRTCManager('ws://localhost:3000', 'Peer A', undefined, MockWebSocket, MockRTCPeerConnection);
    manager.connect();
    await vi.advanceTimersByTimeAsync(1);

    const wsInstance = (manager as any).ws as MockWebSocket;
    wsInstance.onmessage!({
      data: JSON.stringify({
        type: 'PEER_JOINED',
        peerId: 'peer-b-id',
        peerName: 'Peer B',
        topic: 'sala-teste'
      })
    });

    await vi.advanceTimersByTimeAsync(1);

    // Verify connection exists before timeout
    expect((manager as any).peerConnections.has('peer-b-id')).toBe(true);

    // Advance 16 seconds to trigger timeout cleanup
    await vi.advanceTimersByTimeAsync(16000);

    // Connection must have been cleaned up and closed
    expect((manager as any).peerConnections.has('peer-b-id')).toBe(false);
  });

  it('deve limpar conexões se o RTCPeerConnection transitar para failed', async () => {
    const manager = new WebRTCManager('ws://localhost:3000', 'Peer A', undefined, MockWebSocket, MockRTCPeerConnection);
    manager.connect();
    await vi.advanceTimersByTimeAsync(1);

    const wsInstance = (manager as any).ws as MockWebSocket;
    wsInstance.onmessage!({
      data: JSON.stringify({
        type: 'PEER_JOINED',
        peerId: 'peer-b-id',
        peerName: 'Peer B',
        topic: 'sala-teste'
      })
    });

    await vi.advanceTimersByTimeAsync(1);

    const pc = (manager as any).peerConnections.get('peer-b-id') as MockRTCPeerConnection;
    expect(pc).toBeDefined();

    // Trigger state change to failed
    pc.connectionState = 'failed';
    pc.onconnectionstatechange!();

    // Connection must be immediately cleaned up
    expect((manager as any).peerConnections.has('peer-b-id')).toBe(false);
  });
});
