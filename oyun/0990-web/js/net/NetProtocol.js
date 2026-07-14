// ============================================
// NetProtocol — LAN mesaj tipleri (host ↔ istemci sözleşmesi)
// ============================================
// Host = otoriter simülasyon ("gerçeğin sahibi"); istemci = girdi yollar + anlık
// görüntüyü çizer. Tüm mesajlar `{ t: <tip>, ... }` biçimindedir.
//
// İstemci → Host:
//   HELLO   bağlanınca ilk selam ({ name? })
//   INPUT   her kare girdi ({ mv:[x,y], fwd:[x,z] })
//   SHOOT   atış (kendi sırasında release): { aim, power }
//   USEITEM (N2) sabotaj item'i kullan: { role }
//   SHIELD  (N2) kalkan aç
//
// Host → İstemci:
//   START   maç başlasın ({ youAre: 2 })
//   SNAP    anlık görüntü (karakterler + toplar + durum) — ~20-30Hz
//   EVENT   tek seferlik olay (toast/pot/foul/win) — { kind, ... }
//   BYE     host maçı bitirdi / menüye döndü

export const MSG = {
    HELLO:   'hello',
    INPUT:   'in',
    SHOOT:   'shoot',
    USEITEM: 'use',
    SHIELD:  'shield',
    START:   'start',
    SNAP:    'snap',
    EVENT:   'evt',
    BYE:     'bye',
};

// Anlık görüntü gönderim hızı (host). LAN'da 30Hz akıcı + ucuz.
export const SNAP_HZ = 30;

// İstemci girdi gönderim hızı.
export const INPUT_HZ = 30;
