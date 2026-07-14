// ============================================
// NetTransport — WebRTC (PeerJS) Taşıma Katmanı
// ============================================
// Cordova LAN bağlantısı yerine PeerJS üzerinden tarayıcılar arası P2P (WebRTC) altyapısı kullanır.
import Peer from 'peerjs';

const DEFAULT_PORT = 8787;

export function hostingSupported() {
    return true; // WebRTC her modern tarayıcıda desteklenir
}

export function createHostTransport({ port = DEFAULT_PORT, onOpen, onMessage, onClose, onError } = {}) {
    let peer = null;
    let conn = null; // Bağlanan tek istemci
    let started = false;
    let hostId = null;

    return {
        start() {
            return new Promise((resolve, reject) => {
                peer = new Peer(); 
                peer.on('open', (id) => {
                    hostId = id;
                    started = true;
                    resolve({ addr: id, port: DEFAULT_PORT });
                });
                peer.on('connection', (connection) => {
                    if (conn) { connection.close(); return; } // Yalnızca 1 oyuncu kabul et
                    conn = connection;
                    conn.on('open', () => { if (onOpen) onOpen(); });
                    conn.on('data', (data) => {
                        let obj = null;
                        try { obj = typeof data === 'string' ? JSON.parse(data) : data; } catch (_) { return; }
                        if (onMessage) onMessage(obj);
                    });
                    conn.on('close', () => { conn = null; if (onClose) onClose(); });
                    conn.on('error', (err) => { if (onError) onError(err); });
                });
                peer.on('error', (err) => { if (onError) onError(err); reject(err); });
            });
        },
        stop() {
            if (conn) { conn.close(); conn = null; }
            if (peer) { peer.destroy(); peer = null; }
            started = false;
        },
        send(obj) {
            if (conn && conn.open) { conn.send(JSON.stringify(obj)); }
        },
        isConnected() { return !!conn && conn.open; },
        getAddress() {
            return Promise.resolve(hostId ? { ip: hostId, port: DEFAULT_PORT } : null);
        },
    };
}

export function createClientTransport({ url, onOpen, onMessage, onClose, onError } = {}) {
    let peer = null;
    let conn = null;
    
    // Eski koddaki ws://ip:port yapısını temizle, url aslında Host'un Peer ID'si olacak.
    const hostId = url.replace('ws://', '').replace(/:\d+$/, ''); 
    
    return {
        connect() {
            peer = new Peer();
            peer.on('open', () => {
                conn = peer.connect(hostId, { reliable: true });
                conn.on('open', () => { if (onOpen) onOpen(); });
                conn.on('data', (data) => {
                    let obj = null;
                    try { obj = typeof data === 'string' ? JSON.parse(data) : data; } catch (_) { return; }
                    if (onMessage) onMessage(obj);
                });
                conn.on('close', () => { if (onClose) onClose(); });
                conn.on('error', (err) => { if (onError) onError(err); });
            });
            peer.on('error', (err) => { if (onError) onError(err); });
        },
        close() {
            if (conn) { conn.close(); conn = null; }
            if (peer) { peer.destroy(); peer = null; }
        },
        send(obj) {
            if (conn && conn.open) { conn.send(JSON.stringify(obj)); }
        },
        isConnected() { return !!conn && conn.open; },
    };
}

export { DEFAULT_PORT };
