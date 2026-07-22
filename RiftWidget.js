class RiftWidget {
    constructor() {
        this.isOpen = false;
        this.particles = [];
        this.animId = null;
        this.videoLoaded = false;

        // Image & Video Elements
        this.characterImg = new Image();
        this.characterImg.src = '/assets/images/female_cyber_anime_rift.png';
        this.imgLoaded = false;
        this.characterImg.onload = () => { this.imgLoaded = true; };

        this.init();
    }

    init() {
        // Create trigger button
        this.createButton();

        // Create container & canvas & video player
        this.createViewport();

        // Bind events
        this.bindEvents();
    }

    createButton() {
        const btn = document.createElement('button');
        btn.className = 'rift-trigger-btn cursor-target';
        btn.id = 'rift-trigger-btn';
        btn.setAttribute('title', 'Boyut Yarığı (Dimensional Rift)');
        btn.innerHTML = `
            <svg class="rift-btn-icon" viewBox="0 0 24 24">
                <path d="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9L12 2Z" fill="none" stroke="#00d2ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="12" cy="12" r="3" fill="#00d2ff"/>
            </svg>
        `;
        document.body.appendChild(btn);
        this.btn = btn;
    }

    createViewport() {
        const container = document.createElement('div');
        container.className = 'rift-viewport-container';
        container.id = 'rift-viewport-container';

        // Video Player for Higgsfield Generated Video
        const video = document.createElement('video');
        video.className = 'rift-video-player';
        video.id = 'rift-video-player';
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        container.appendChild(video);
        this.video = video;

        // Canvas for dynamic diagonal slash line & 60FPS particles
        const canvas = document.createElement('canvas');
        canvas.className = 'rift-canvas-render';
        container.appendChild(canvas);

        document.body.appendChild(container);

        this.container = container;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    setVideoSource(url) {
        if (this.video) {
            this.video.src = url;
            this.video.load();
            this.videoLoaded = true;
        }
    }

    resize() {
        if (!this.canvas) return;
        const rect = this.container.getBoundingClientRect();
        this.width = this.canvas.width = rect.width * (window.devicePixelRatio || 1);
        this.height = this.canvas.height = rect.height * (window.devicePixelRatio || 1);
    }

    bindEvents() {
        if (this.btn) {
            this.btn.addEventListener('click', () => this.toggle());
        }
    }

    toggle() {
        this.isOpen = !this.isOpen;

        if (this.isOpen) {
            this.container.classList.add('active');
            if (this.video && this.videoLoaded) {
                this.video.play().catch(() => {});
            }
            this.spawnElectricParticles();
            this.startAnimation();
        } else {
            this.container.classList.remove('active');
            if (this.video) this.video.pause();
            if (this.animId) cancelAnimationFrame(this.animId);
        }
    }

    spawnElectricParticles() {
        this.particles = [];
        const count = 60;
        for (let i = 0; i < count; i++) {
            // Spawn along diagonal slash line
            const t = Math.random();
            const sx = this.width * (0.85 - t * 0.7);
            const sy = this.height * (t * 1.0);

            this.particles.push({
                x: sx,
                y: sy,
                vx: (Math.random() - 0.5) * 8 - 4,
                vy: (Math.random() - 0.5) * 8 - 2,
                size: Math.random() * 5 + 2,
                alpha: 1,
                decay: Math.random() * 0.02 + 0.01,
                color: Math.random() > 0.25 ? '#00d2ff' : '#ffffff'
            });
        }
    }

    startAnimation() {
        let frame = 0;
        const render = () => {
            if (!this.isOpen) return;
            frame++;

            this.ctx.clearRect(0, 0, this.width, this.height);

            // Draw Dynamic Diagonal Tear Slash Line (Matching User's Red Sketch)
            this.drawDiagonalSlashLine(frame);

            // Draw Electric Slash Particles
            this.updateAndDrawParticles();

            this.animId = requestAnimationFrame(render);
        };
        render();
    }

    drawDiagonalSlashLine(frame) {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.save();

        const progress = Math.min(1, frame / 20);

        // Diagonal Tear Slash Line (From Top Right to Bottom Left)
        const x1 = w * 0.85;
        const y1 = 0;
        const x2 = w * (0.85 - 0.7 * progress);
        const y2 = h * progress;

        // Outer Glow Line
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = '#00e1ff';
        ctx.lineWidth = 10;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 35;
        ctx.stroke();

        // Inner Core Cyan Line
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 15;
        ctx.stroke();

        // Jagged Energy Lightning Slashes along Tear Line
        if (frame % 2 === 0) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            const midX = (x1 + x2) / 2 + (Math.random() - 0.5) * 30;
            const midY = (y1 + y2) / 2 + (Math.random() - 0.5) * 30;
            ctx.lineTo(midX, midY);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        ctx.restore();
    }

    updateAndDrawParticles() {
        const ctx = this.ctx;
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.alpha -= p.decay;

            if (p.alpha <= 0) {
                this.particles.splice(i, 1);
                continue;
            }

            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    window.riftWidget = new RiftWidget();
});
