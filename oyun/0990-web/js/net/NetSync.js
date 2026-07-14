// ============================================
// NetSync — anlık görüntü (snapshot) kur/uygula
// ============================================
// HOST her ~25Hz'de buildSnapshot ile dünyanın özetini (iki karakter + aktif toplar
// + durum) kodlar; İSTEMCİ applySnapshot ile bunu fizik çalıştırmadan çizer.
// Konum yumuşatma Player.applyNet/Balls.syncWithPhysics içinde. JSON taşınır;
// değerler 4 ondalığa yuvarlanır (0.1mm hassasiyet — yeterli, bayt düşük).

const r = (v) => Math.round(v * 1e4) / 1e4;

function encodePlayer(p) {
    const b = p.body.position;
    const o = { p: [r(b.x), r(b.y), r(b.z)], r: r(p.mesh.rotation.y), a: p.getNetAnim(), g: p.isRagdoll ? 1 : 0 };
    if (p.isRagdoll) { const q = p.body.quaternion; o.q = [r(q.x), r(q.y), r(q.z), r(q.w)]; }
    return o;
}

/** HOST: dünyayı snapshot objesine kodla. */
export function buildSnapshot(players, ballPhysics, gameManager) {
    const b = [];
    ballPhysics.getPositions().forEach((pos, id) => b.push([id, r(pos.x), r(pos.y), r(pos.z)]));
    return {
        t: 'snap',
        pl: [encodePlayer(players[1]), encodePlayer(players[2])],
        b,
        st: {
            s: gameManager.getState(),
            cp: gameManager.currentPlayer,
            t1: gameManager.player1Type,
            t2: gameManager.player2Type,
        },
    };
}

/** İSTEMCİ: tek snapshot'ı doğrudan uygula (tampon henüz dolmadıysa — başlangıç). */
export function applySnapshot(snap, dt, players, balls) {
    if (snap.pl) {
        const a = snap.pl[0], c = snap.pl[1];
        if (a) players[1].applyNet(dt, a.p[0], a.p[1], a.p[2], a.r, a.a, !!a.g, a.q);
        if (c) players[2].applyNet(dt, c.p[0], c.p[1], c.p[2], c.r, c.a, !!c.g, c.q);
    }
    if (snap.b) {
        const map = new Map();
        const present = new Set();
        for (const it of snap.b) { map.set(it[0], { x: it[1], y: it[2], z: it[3] }); present.add(it[0]); }
        balls.syncWithPhysics(map);
        for (const id of balls.getAllActiveBallIds()) if (!present.has(id)) balls.removeBall(id);
    }
}

/** En kısa yoldan açı interpolasyonu (±π sarması). */
function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * t;
}

function lerpPlayer(p, e0, e1, alpha, dt) {
    if (!e0 || !e1) return;
    const rag = !!e1.g;   // ragdoll durumunu YENİ snapshot belirler (interpolasyon yok)
    const x = e0.p[0] + (e1.p[0] - e0.p[0]) * alpha;
    const y = e0.p[1] + (e1.p[1] - e0.p[1]) * alpha;
    const z = e0.p[2] + (e1.p[2] - e0.p[2]) * alpha;
    const ry = lerpAngle(e0.r, e1.r, alpha);
    p.applyNet(dt, x, y, z, ry, e1.a, rag, e1.q);
}

/**
 * İSTEMCİ: iki snapshot arası interpolasyonla uygula (alpha 0..1). Akıcı hareket
 * için ana yol — render zamanı ~INTERP_DELAY geride olduğundan jitter yutulur.
 */
export function applySnapshotLerp(s0, s1, alpha, dt, players, balls) {
    if (s0.pl && s1.pl) {
        lerpPlayer(players[1], s0.pl[0], s1.pl[0], alpha, dt);
        lerpPlayer(players[2], s0.pl[1], s1.pl[1], alpha, dt);
    }
    if (s1.b) {
        const m0 = new Map();
        if (s0.b) for (const it of s0.b) m0.set(it[0], it);
        const map = new Map();
        const present = new Set();
        for (const it1 of s1.b) {
            const id = it1[0]; present.add(id);
            const it0 = m0.get(id) || it1;
            map.set(id, {
                x: it0[1] + (it1[1] - it0[1]) * alpha,
                y: it0[2] + (it1[2] - it0[2]) * alpha,
                z: it0[3] + (it1[3] - it0[3]) * alpha,
            });
        }
        balls.syncWithPhysics(map);
        for (const id of balls.getAllActiveBallIds()) if (!present.has(id)) balls.removeBall(id);
    }
}
