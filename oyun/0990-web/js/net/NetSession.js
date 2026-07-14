// ============================================
// NetSession — LAN oturumu (rol + taşıma + mesaj yönlendirme)
// ============================================
// main.js'in tek dokunduğu net nesnesi. Bir transport (host/istemci) sarar, gelen
// mesajları tip → callback olarak dağıtır, giden mesajlar için kısa yardımcılar verir.
// Oyun mantığı bilmez (sadece boru); anlık görüntü/girdi içeriğini main.js kurar/uygular.
import { createHostTransport, createClientTransport, hostingSupported, DEFAULT_PORT } from './NetTransport.js';
import { MSG } from './NetProtocol.js';

export class NetSession {
    constructor() {
        this.role = null;          // 'host' | 'client' | null
        this.transport = null;
        this.connected = false;

        // main.js bağlar (hepsi opsiyonel):
        this.onPeerOpen = null;    // host: istemci bağlandı · istemci: sokete açıldı
        this.onPeerClose = null;   // bağlantı koptu
        this.onError = null;       // (reason)
        this.onInput = null;       // host: istemci girdisi geldi (obj)
        this.onShoot = null;       // host: istemci atışı (obj{aim,power})
        this.onUseItem = null;     // host: istemci item kullandı (obj{role})  (N2)
        this.onShield = null;      // host: istemci kalkan açtı                (N2)
        this.onStart = null;       // istemci: host START yolladı (obj{youAre})
        this.onSnap = null;        // istemci: anlık görüntü (obj)
        this.onEvent = null;       // istemci: tek seferlik olay (obj)
        this.onBye = null;         // istemci: host ayrıldı
    }

    static canHost() { return hostingSupported(); }

    /** HOST: sunucuyu başlat. Çözülürse { ip, port } (istemciye gösterilecek). */
    async host(port = DEFAULT_PORT) {
        this.role = 'host';
        this.transport = createHostTransport({
            port,
            onOpen: () => { this.connected = true; if (this.onPeerOpen) this.onPeerOpen(); },
            onClose: () => { this.connected = false; if (this.onPeerClose) this.onPeerClose(); },
            onMessage: (obj) => this._routeHost(obj),
            onError: (r) => { if (this.onError) this.onError(r); },
        });
        await this.transport.start();
        const addr = await this.transport.getAddress();
        return addr || { ip: null, port };
    }

    /** İSTEMCİ: host'un ws adresine bağlan. */
    join(url) {
        this.role = 'client';
        this.transport = createClientTransport({
            url,
            onOpen: () => {
                this.connected = true;
                this.send({ t: MSG.HELLO });
                if (this.onPeerOpen) this.onPeerOpen();
            },
            onClose: () => { this.connected = false; if (this.onPeerClose) this.onPeerClose(); },
            onMessage: (obj) => this._routeClient(obj),
            onError: (r) => { if (this.onError) this.onError(r); },
        });
        this.transport.connect();
    }

    _routeHost(obj) {
        switch (obj.t) {
            case MSG.HELLO:   /* selam — bağlantı zaten açık */ break;
            case MSG.INPUT:   if (this.onInput) this.onInput(obj); break;
            case MSG.SHOOT:   if (this.onShoot) this.onShoot(obj); break;
            case MSG.USEITEM: if (this.onUseItem) this.onUseItem(obj); break;
            case MSG.SHIELD:  if (this.onShield) this.onShield(obj); break;
        }
    }

    _routeClient(obj) {
        switch (obj.t) {
            case MSG.START: if (this.onStart) this.onStart(obj); break;
            case MSG.SNAP:  if (this.onSnap) this.onSnap(obj); break;
            case MSG.EVENT: if (this.onEvent) this.onEvent(obj); break;
            case MSG.BYE:   if (this.onBye) this.onBye(); break;
        }
    }

    send(obj) { if (this.transport) this.transport.send(obj); }

    isHost() { return this.role === 'host'; }
    isClient() { return this.role === 'client'; }
    isActive() { return !!this.role; }

    close() {
        if (this.transport) {
            try { if (this.role === 'host') this.transport.stop(); else this.transport.close(); }
            catch (_) {}
        }
        this.transport = null;
        this.role = null;
        this.connected = false;
    }
}
