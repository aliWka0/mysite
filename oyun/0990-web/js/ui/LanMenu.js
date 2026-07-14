// ============================================
// LanMenu — "İki Cihaz (LAN)" bağlanma ekranı denetleyicisi
// ============================================
// #lan-menu overlay'ini yönetir (sunucu kur / katıl seçimi, IP gösterimi/girişi,
// durum metni). Yalnız DOM işi yapar; gerçek ağ mantığı main.js'te (callback'ler).
//   onHost()        → kullanıcı "Sunucu Kur" dedi (main host'u başlatır → setHostAddress)
//   onJoin(ip)      → kullanıcı IP girip "BAĞLAN" dedi
//   onStart()       → host "BAŞLAT" dedi (istemci bağlıyken)
//   onBack()        → ekrandan çıkıldı (menüye dön + bağlantıyı kapat)

export class LanMenu {
    constructor({ sound } = {}) {
        this.sound = sound || null;
        this.root = document.getElementById('lan-menu');
        this.choose = document.getElementById('lan-choose');
        this.hostPanel = document.getElementById('lan-host-panel');
        this.joinPanel = document.getElementById('lan-join-panel');
        this.hostAddr = document.getElementById('lan-host-addr');
        this.hostStatus = document.getElementById('lan-host-status');
        this.startBtn = document.getElementById('lan-start-btn');
        this.ipInput = document.getElementById('lan-ip-input');
        this.joinStatus = document.getElementById('lan-join-status');

        this._onHost = null; this._onJoin = null; this._onStart = null; this._onBack = null;
        this._view = 'choose';
        this._wire();
    }

    onHost(cb) { this._onHost = cb; return this; }
    onJoin(cb) { this._onJoin = cb; return this; }
    onStart(cb) { this._onStart = cb; return this; }
    onBack(cb) { this._onBack = cb; return this; }

    _wire() {
        const ui = (n) => { if (this.sound) this.sound.playUI(n); };

        document.getElementById('lan-host-btn').addEventListener('click', () => {
            ui('confirm'); this._show('host');
            this.setHostStatus('Sunucu başlatılıyor…');
            if (this._onHost) this._onHost();
        });
        document.getElementById('lan-join-btn').addEventListener('click', () => {
            ui('confirm'); this._show('join');
            setTimeout(() => this.ipInput && this.ipInput.focus(), 50);
        });
        document.getElementById('lan-connect-btn').addEventListener('click', () => {
            const ip = (this.ipInput.value || '').trim();
            if (!ip) { this.setJoinStatus('Önce IP gir', 'err'); return; }
            ui('confirm');
            this.setJoinStatus('Bağlanılıyor…');
            if (this._onJoin) this._onJoin(ip);
        });
        this.startBtn.addEventListener('click', () => {
            ui('confirm');
            if (this._onStart) this._onStart();
        });
        document.getElementById('lan-back').addEventListener('click', () => {
            ui('move');
            if (this._onBack) this._onBack();   // her zaman ana menüye çık + oturumu kapat (main karar verir)
        });
    }

    _show(view) {
        this._view = view;
        this.choose.classList.toggle('hidden', view !== 'choose');
        this.hostPanel.classList.toggle('hidden', view !== 'host');
        this.joinPanel.classList.toggle('hidden', view !== 'join');
        if (view !== 'host') { this.startBtn.classList.add('hidden'); }
    }

    show() {
        this.root.classList.remove('hidden');
        this._show('choose');
        this.setJoinStatus('');
    }
    hide() { this.root.classList.add('hidden'); }

    /** Host: bu cihazın LAN adresini göster (istemciye verilecek). */
    setHostAddress(addr) {
        if (!addr || !addr.ip) { this.hostAddr.textContent = 'IP bulunamadı'; return; }
        this.hostAddr.textContent = `${addr.ip} : ${addr.port}`;
        // Emülatör NAT IP'si (10.0.2.x) dışarıdan erişilemez → gerçek telefon gerekir.
        if (/^10\.0\.2\./.test(addr.ip)) {
            this.setHostStatus('⚠️ Bu bir emülatör IP\'si — dışarıdan erişilemez. Gerçek telefonda WiFi IP (192.168.x.x) çıkar.', 'err');
        }
    }
    setHostStatus(text, cls) { this._setStatus(this.hostStatus, text, cls); }
    setJoinStatus(text, cls) { this._setStatus(this.joinStatus, text, cls); }

    /** Host: istemci bağlandı → durum + "BAŞLAT" butonunu aç. */
    hostConnected() {
        this.setHostStatus('Arkadaşın bağlandı! 🎉', 'ok');
        this.startBtn.classList.remove('hidden');
    }

    _setStatus(el, text, cls) {
        if (!el) return;
        el.textContent = text || '';
        el.classList.remove('ok', 'err');
        if (cls) el.classList.add(cls);
    }
}
