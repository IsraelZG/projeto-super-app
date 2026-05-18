import { ulid } from 'ulid';
import { logger } from '../../core/logger';

type MessageHandler = (peerId: string, topic: string, message: Uint8Array) => void;
type ConnectionHandler = (peerId: string) => void;

export class WebRTCManager {
  private ws: WebSocket | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  
  public myPeerId: string;
  public myPeerName: string = 'Anonymous';
  private joinedTopics: Set<string> = new Set();
  private peerNames: Map<string, string> = new Map();
  
  private onMessageHandler: MessageHandler | null = null;
  private onConnectionHandler: ConnectionHandler | null = null;
  private signalingUrl: string;
  private iceCandidatesQueue: Map<string, any[]> = new Map();
  private iceServers: RTCConfiguration['iceServers'] = [{ urls: 'stun:stun.l.google.com:19302' }];
  
  private WebSocketClass: any;
  private RTCPeerConnectionClass: any;
  
  constructor(
    signalingUrl: string, 
    peerName?: string, 
    iceServers?: RTCConfiguration['iceServers'],
    WebSocketClass?: any,
    RTCPeerConnectionClass?: any
  ) {
    this.signalingUrl = signalingUrl;
    this.myPeerId = ulid();
    if (peerName) this.myPeerName = peerName;
    if (iceServers) this.iceServers = iceServers;
    this.WebSocketClass = WebSocketClass || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    this.RTCPeerConnectionClass = RTCPeerConnectionClass || (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null);
  }

  public setOnMessage(handler: MessageHandler) {
    this.onMessageHandler = handler;
  }

  public setOnConnection(handler: ConnectionHandler) {
    this.onConnectionHandler = handler;
  }

  public connect() {
    const ws = new this.WebSocketClass(this.signalingUrl);
    this.ws = ws;
    
    ws.onopen = () => {
      logger.info('WebRTC', `Signaling connected as ${this.myPeerId} (${this.myPeerName})`);
      // Re-join topics if reconnected
      for (const topic of this.joinedTopics) {
        this.sendSignaling({ type: 'JOIN', topics: [topic], peerId: this.myPeerId, peerName: this.myPeerName });
      }
    };

    ws.onmessage = async (event: any) => {
      const data = JSON.parse(event.data);

      if (data.type === 'PEER_JOINED') {
        logger.info('WebRTC', `PEER_JOINED received for ${data.peerId} (${data.peerName})`);
        // Someone joined our topic, we initiate connection!
        if (data.peerName) {
          this.peerNames.set(data.peerId, data.peerName);
        }
        this.initiateConnection(data.peerId, data.topic);
      } 
      else if (data.type === 'ROOM_JOINED') {
        logger.info('WebRTC', `ROOM_JOINED. Existing peers: ${data.peers.length}`);
        // We joined a room, learn existing peers
        data.peers.forEach((p: any) => {
          if (p.peerName) this.peerNames.set(p.peerId, p.peerName);
        });
      }
      else if (data.type === 'WEBRTC_MESSAGE') {
        logger.debug('WebRTC', `WEBRTC_MESSAGE received from ${data.senderId}: ${data.payload.type}`);
        // We received WebRTC signaling data
        await this.handleSignalingData(data.senderId, data.topic, data.payload);
      }
      else if (data.type === 'SYNC_MESSAGE') {
        // Decode base64 to Uint8Array safely in browser environment
        const binary = new Uint8Array(
          atob(data.message)
            .split('')
            .map(c => c.charCodeAt(0))
        );

        if (this.onMessageHandler) {
          this.onMessageHandler('cloud-peer', data.topic, binary);
        }
      }
    };

    ws.onclose = () => {
      logger.warn('WebRTC', 'Signaling disconnected, retrying in 3s...');
      setTimeout(() => this.connect(), 3000);
    };
  }

  public joinTopic(topic: string) {
    this.joinedTopics.add(topic);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSignaling({ type: 'JOIN', topics: [topic], peerId: this.myPeerId, peerName: this.myPeerName });
    }
  }

  public hasConnections() {
    return this.dataChannels.size > 0;
  }

  public getConnectedPeers(): { peerId: string, peerName: string }[] {
    return Array.from(this.dataChannels.keys()).map(id => ({
      peerId: id,
      peerName: this.peerNames.get(id) || 'Anonymous'
    }));
  }

  public broadcast(topic: string, message: Uint8Array) {
    // Send to all peers in this topic
    for (const [peerId, channel] of this.dataChannels.entries()) {
      if (channel.readyState === 'open') {
        const encoder = new TextEncoder();
        const topicBuffer = encoder.encode(topic);
        const out = new Uint8Array(1 + topicBuffer.length + message.length);
        out[0] = topicBuffer.length;
        out.set(topicBuffer, 1);
        out.set(message, 1 + topicBuffer.length);
        
        try {
          channel.send(out);
        } catch (err) {
          logger.error('WebRTC', `Failed to broadcast message to ${peerId}`, err);
        }
      }
    }

    // ALSO broadcast directly to the Cloud Peer via WebSocket!
    if (this.ws?.readyState === WebSocket.OPEN) {
      const base64 = btoa(String.fromCharCode(...message));
      this.sendSignaling({
        type: 'SYNC_MESSAGE',
        topic,
        message: base64
      });
    }
  }

  private sendSignaling(msg: any) {
    this.ws?.send(JSON.stringify(msg));
  }

  private getOrCreatePeerConnection(peerId: string, topic: string): RTCPeerConnection {
    if (this.peerConnections.has(peerId)) {
      return this.peerConnections.get(peerId)!;
    }

    const pc = new this.RTCPeerConnectionClass({
      iceServers: this.iceServers
    });

    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        this.sendSignaling({
          type: 'WEBRTC_MESSAGE',
          topic,
          senderId: this.myPeerId,
          targetId: peerId,
          payload: { type: 'ice', candidate: event.candidate }
        });
      }
    };

    pc.ondatachannel = (event: RTCDataChannelEvent) => {
      this.setupDataChannel(peerId, event.channel);
    };

    pc.onconnectionstatechange = () => {
      logger.info('WebRTC', `Connection state with ${peerId} changed to: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        logger.warn('WebRTC', `Connection with ${peerId} failed or closed. Cleaning up.`);
        this.cleanupConnection(peerId);
      }
    };

    this.peerConnections.set(peerId, pc);
    this.iceCandidatesQueue.set(peerId, []);
    return pc;
  }

  private cleanupConnection(peerId: string) {
    logger.warn('WebRTC', `Cleaning up connection with peer ${peerId}`);
    const channel = this.dataChannels.get(peerId);
    if (channel) {
      try {
        channel.close();
      } catch {}
      this.dataChannels.delete(peerId);
    }
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      this.peerConnections.delete(peerId);
    }
    this.iceCandidatesQueue.delete(peerId);
  }

  private setupDataChannel(peerId: string, channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    
    const handleOpen = () => {
      if (!this.dataChannels.has(peerId)) {
        logger.info('WebRTC', `P2P DataChannel open with ${peerId}`);
        this.dataChannels.set(peerId, channel);
        if (this.onConnectionHandler) {
          this.onConnectionHandler(peerId);
        }
      }
    };

    if (channel.readyState === 'open') {
      handleOpen();
    } else {
      channel.onopen = handleOpen;
    }

    channel.onclose = () => {
      logger.info('WebRTC', `P2P DataChannel closed with ${peerId}`);
      this.cleanupConnection(peerId);
    };

    channel.onerror = (err) => {
      logger.error('WebRTC', `P2P DataChannel error with ${peerId}`, err);
      this.cleanupConnection(peerId);
    };

    channel.onmessage = (event) => {
      const buffer = new Uint8Array(event.data);
      // Read topic
      const topicLen = buffer[0];
      const decoder = new TextDecoder();
      const topic = decoder.decode(buffer.slice(1, 1 + topicLen));
      const message = buffer.slice(1 + topicLen);
      
      if (this.onMessageHandler) {
        this.onMessageHandler(peerId, topic, message);
      }
    };
  }

  private async initiateConnection(peerId: string, topic: string) {
    logger.info('WebRTC', `Initiating connection to ${peerId}...`);
    const pc = this.getOrCreatePeerConnection(peerId, topic);
    const channel = pc.createDataChannel('sync-channel');
    this.setupDataChannel(peerId, channel);

    const handshakeTimeout = setTimeout(() => {
      const activeChannel = this.dataChannels.get(peerId);
      if (!activeChannel || activeChannel.readyState !== 'open') {
        logger.warn('WebRTC', `Handshake timeout with ${peerId} after 15s. Cleaning up.`);
        this.cleanupConnection(peerId);
      }
    }, 15000);

    const originalOnOpen = channel.onopen;
    channel.onopen = (e) => {
      clearTimeout(handshakeTimeout);
      if (originalOnOpen) (originalOnOpen as any)(e);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    logger.info('WebRTC', `Sending offer to ${peerId}...`);
    this.sendSignaling({
      type: 'WEBRTC_MESSAGE',
      topic,
      senderId: this.myPeerId,
      targetId: peerId,
      payload: { type: 'offer', sdp: offer }
    });
  }

  private async handleSignalingData(senderId: string, topic: string, payload: any) {
    try {
      if (payload.type === 'offer') {
        const pc = this.getOrCreatePeerConnection(senderId, topic);
        
        const handshakeTimeout = setTimeout(() => {
          const activeChannel = this.dataChannels.get(senderId);
          if (!activeChannel || activeChannel.readyState !== 'open') {
            logger.warn('WebRTC', `Incoming handshake timeout with ${senderId} after 15s. Cleaning up.`);
            this.cleanupConnection(senderId);
          }
        }, 15000);

        const originalOnDataChannel = pc.ondatachannel;
        pc.ondatachannel = (event) => {
          this.setupDataChannel(senderId, event.channel);
          
          const channel = event.channel;
          const originalOnOpen = channel.onopen;
          channel.onopen = (e) => {
            clearTimeout(handshakeTimeout);
            if (originalOnOpen) (originalOnOpen as any)(e);
          };
          
          if (originalOnDataChannel) (originalOnDataChannel as any)(event);
        };

        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.sendSignaling({
          type: 'WEBRTC_MESSAGE',
          topic,
          senderId: this.myPeerId,
          targetId: senderId,
          payload: { type: 'answer', sdp: answer }
        });
        this.flushIceQueue(senderId);
      } else if (payload.type === 'answer') {
        const pc = this.peerConnections.get(senderId);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          this.flushIceQueue(senderId);
        }
      } else if (payload.type === 'ice') {
        const pc = this.peerConnections.get(senderId);
        if (pc) {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } else {
            this.iceCandidatesQueue.get(senderId)?.push(payload.candidate);
          }
        }
      }
    } catch (err) {
      logger.error('WebRTC', 'Signaling Error:', err);
    }
  }

  private flushIceQueue(peerId: string) {
    const pc = this.peerConnections.get(peerId);
    const queue = this.iceCandidatesQueue.get(peerId);
    if (pc && queue) {
      for (const candidate of queue) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => logger.error('WebRTC', 'ICE Error:', e));
      }
      this.iceCandidatesQueue.set(peerId, []);
    }
  }
}

