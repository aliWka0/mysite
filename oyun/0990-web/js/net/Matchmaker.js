import mqtt from 'mqtt';

export class Matchmaker {
    constructor(hostId) {
        this.hostId = hostId;
        this.client = null;
        this.matched = false;
        this.isHost = true; 
        this.matchTimeout = null;
    }

    findMatch(onMatch, onTimeout) {
        // Websocket üzerinden public MQTT broker kullanarak eşleşme havuzu kuruyoruz
        this.client = mqtt.connect('wss://test.mosquitto.org:8081');

        this.client.on('connect', () => {
            this.client.subscribe('billiard_lobby_v1', (err) => {
                if (!err) {
                    // Bağlandığımızda herkese ID'mizi duyur
                    this.broadcastPresence();
                }
            });
        });

        this.client.on('message', (topic, message) => {
            if (this.matched) return;
            try {
                const data = JSON.parse(message.toString());
                if (data.type === 'LOOKING_FOR_MATCH' && data.id !== this.hostId) {
                    // Başka biri daha eşleşme arıyor!
                    // İki kişi aynı anda host olmaya çalışıyorsa (Race condition), 
                    // ID'si string olarak "büyük" olan Host kalır, küçük olan Client (bağlanan) olur.
                    if (this.hostId > data.id) {
                        // Ben host'um, onun client olarak bana bağlanmasını bekleyeceğim.
                        // (O benim varlığımı duyup client olarak bağlanacak)
                        this.broadcastPresence(); 
                    } else {
                        // Ben client olacağım. Onun Host ID'sine (WebRTC) bağlanacağım.
                        this.isHost = false;
                        this.matched = true;
                        this.stopMatchmaking();
                        onMatch({ isHost: false, hostId: data.id });
                    }
                }
            } catch(e) {}
        });

        // 15 Saniye bot beklemesi (Timeout)
        this.matchTimeout = setTimeout(() => {
            if (!this.matched) {
                this.stopMatchmaking();
                onTimeout(); // 15 sn geçti adam yok, VS BOT ile başlat.
            }
        }, 15000);
    }

    broadcastPresence() {
        if (this.client && !this.matched) {
            this.client.publish('billiard_lobby_v1', JSON.stringify({
                type: 'LOOKING_FOR_MATCH',
                id: this.hostId
            }));
        }
    }

    stopMatchmaking() {
        this.matched = true;
        if (this.client) {
            this.client.end();
            this.client = null;
        }
        if (this.matchTimeout) {
            clearTimeout(this.matchTimeout);
        }
    }
}
