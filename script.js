document.addEventListener('DOMContentLoaded', () => {

    // --- Hero Animation: Antigravity 3D Particle Cloud ---
    const canvas = document.querySelector('.stagger-visualizer');
    const ctx = canvas.getContext('2d');

    // 3D Configuration
    const particleCount = 350; // Optimized for Constellation Lines
    const focalLength = 400;
    const depth = 2000;

    let particles = [];
    let mouse = { x: 0, y: 0 };
    let targetMouse = { x: 0, y: 0 }; // For smooth easing
    let width, height;
    let clickPulse = 0; // Tıklama ile oluşan şok dalgası enerjisi
    window.warpSpeedOffset = 0; // Cinematic scroll speed multiplier

    // Tıklama Şok Dalgası (Shockwave) Events
    // Basılı tutmayı iptal edip sadece tıklandığı an enerji patlaması yaratıyoruz
    window.addEventListener('mousedown', () => clickPulse = 2.0);
    window.addEventListener('touchstart', (e) => {
        // Mobilde ilk dokunuşta karadelik rastgele bir yerde (eski mouse konumunda) oluşmasın diye hedefe anında atlar
        if (e.touches && e.touches.length > 0) {
            targetMouse.x = e.touches[0].clientX;
            targetMouse.y = e.touches[0].clientY;
            mouse.x = targetMouse.x;
            mouse.y = targetMouse.y;
        }
        clickPulse = 2.0;
    });

    function resize() {
        // Set canvas to full screen/window size to ensure global coverage
        const wrapper = document.querySelector('.animation-wrapper');
        width = canvas.width = wrapper.offsetWidth; // Should match window width if fixed
        height = canvas.height = wrapper.offsetHeight;
        initParticles();
    }

    class Particle {
        constructor() {
            this.reset();
        }

        reset() {
            // Wider spread for full coverage even at corners (Fix for "insufficient")
            // Increased multiplier from 4 to 8 to cover aggressive parallax shifts
            this.x = (Math.random() - 0.5) * width * 8;
            this.y = (Math.random() - 0.5) * height * 8;
            this.z = Math.random() * depth;

            // Daha belirgin ve büyük noktalar
            this.size = Math.random() * 4 + 2;
            this.color = Math.random() > 0.5 ? '#ffffff' : '#888888'; // White and gray theme

            this.isShooter = Math.random() > 0.95; // More shooters
            this.velZ = this.isShooter ? Math.random() * 20 + 10 : 0; // Faster shooters
        }

        update() {
            // Interactive Physics (Repel & Vortex)
            // Kamera hareketi nedeniyle parçacığın sahte konumu hesaplanıyor
            const cameraX = (mouse.x - width / 2) * 5.0;
            const cameraY = (mouse.y - height / 2) * 5.0;
            
            // Farenin uzaydaki göreceli pozisyonu (basit izdüşüm)
            const dx = this.x - cameraX;
            const dy = this.y - cameraY;
            const dist = Math.sqrt(dx*dx + dy*dy);

            // VORTEX PULSE (Tıklama ile Karadelik)
            // Basılı tutma kaosunu engeller ancak ard arda tıklamalarda sevdiğiniz içeri çekme/spiral (vortex) etkisini geri getirir
            if (clickPulse > 0.01 && dist < 2500) { 
                const force = (2500 - dist) / 2500;
                // Sistem hızı (çekim gücü) çok düşürüldü. Relaxing (Slow-motion) akış sağlandı.
                this.x -= (dx * 0.02 * force * clickPulse) + (dy * 0.03 * force * clickPulse); 
                this.y -= (dy * 0.02 * force * clickPulse) - (dx * 0.03 * force * clickPulse);
                this.z -= force * 3 * clickPulse; // Eskiden 20'ydi, çok yumuşatıldı
            } else {
                // MAGNETIC REPULSION (Gezinirken Fare Kalkanı)
                if (dist < 400) {
                    const force = (400 - dist) / 400;
                    this.x += dx * 0.15 * force; 
                    this.y += dy * 0.15 * force;
                }
            }

            // Normal İleri Hareket (Warp dahil)
            const baseSpeed = this.isShooter ? this.velZ : 2;
            const speed = baseSpeed + window.warpSpeedOffset;
            this.z -= speed;

            // Kamera arkasına geçtiğinde veya çok uzağa itildiğinde resetle
            if (this.z <= 0 || this.x > width * 10 || this.x < -width * 10 || this.y > height * 10 || this.y < -height * 10) {
                this.reset();
                this.z = depth; // En arkadan yeniden doğ
            }
        }

        draw(ctx) {
            // 1. Calculate Perspective
            // Simple camera tilt: shift x/y logic based on mouse
            // We shift the "world" opposite to mouse to simulate camera turn
            // Aggressive Camera Tilt (Increased multiplier 1.5 -> 5.0)
            const cameraX = (mouse.x - width / 2) * 5.0;
            const cameraY = (mouse.y - height / 2) * 5.0;

            // Apply parallax: Closer items (low z) shift more? 
            // In standard 3D: shift = camera * (factor)
            // Let's model rotation: x' = x * cos(angle) - z * sin(angle)
            // Simplified Parallax Shift:
            const shiftX = (cameraX * (depth - this.z)) / depth;
            const shiftY = (cameraY * (depth - this.z)) / depth;

            // Final 3D point relative to camera
            const x3d = this.x - shiftX;
            const y3d = this.y - shiftY;
            const z3d = this.z;

            // Clip if behind camera
            if (z3d <= -focalLength) return;

            // 2. Projection (3D -> 2D)
            const scale = focalLength / (focalLength + z3d);
            const x2d = x3d * scale + width / 2;
            const y2d = y3d * scale + height / 2;

            // Cache 2D coordinates for constellation lines later
            this.x2d = x2d;
            this.y2d = y2d;
            
            // Atmospheric Depth Fog (Derinlik Sisi ve Renk)
            this.depthRatio = Math.max(0, 1 - (z3d / depth)); // 1 = yakın, 0 = uzak
            const cVal = Math.floor(150 + 105 * this.depthRatio); // Karanlıkta bile tamamen siyah olmasın
            const dynamicColor = `rgb(${cVal}, ${cVal}, ${cVal})`; // Tamamen gri/beyaz (tema rengi)
            
            ctx.globalAlpha = Math.max(0.3, this.depthRatio); // Görünmez olmasınlar, en az %30 görünür kalsınlar
            ctx.fillStyle = dynamicColor;

            // Different drawing for shooters vs stars
            if (this.isShooter) {
                // Realistic Comet Trails (Linear Gradient)
                // Kuyruğun uzaydaki konumu (hızına bağlı olarak geride kalır)
                const trailScale = focalLength / (focalLength + z3d + (this.velZ * 8));
                const tx = (this.x - shiftX) * trailScale + width / 2;
                const ty = (this.y - shiftY) * trailScale + height / 2;
                
                const grad = ctx.createLinearGradient(x2d, y2d, tx, ty);
                grad.addColorStop(0, `rgba(255, 255, 255, ${this.depthRatio})`); // Başı parlak
                grad.addColorStop(1, 'rgba(255, 255, 255, 0)'); // Kuyruk eriyerek yok olur
                
                ctx.beginPath();
                ctx.moveTo(x2d, y2d);
                ctx.lineTo(tx, ty);
                ctx.strokeStyle = grad;
                ctx.lineWidth = 3 * scale;
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(x2d, y2d, this.size * scale, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }
    }

    function initParticles() {
        particles = [];
        for (let i = 0; i < particleCount; i++) {
            particles.push(new Particle());
        }
    }

    function animate() {
        ctx.clearRect(0, 0, width, height);

        // Her karede şok dalgasının enerjisi yavaşça sönümlenir (Slow-motion etki için 0.9'dan 0.96'ya çıkarıldı)
        clickPulse *= 0.96;

        // Smooth Mouse Easing (Camera inertia)
        mouse.x += (targetMouse.x - mouse.x) * 0.05;
        mouse.y += (targetMouse.y - mouse.y) * 0.05;

        // Render particles sorted by depth
        particles.sort((a, b) => b.z - a.z);
        particles.forEach(p => {
            p.update();
            p.draw(ctx);
        });

        // Draw Constellation / Network Lines (Kaldırıldı - Göz yormayı önlemek için)
        requestAnimationFrame(animate);
    }

    // Init Logic
    window.addEventListener('resize', resize);
    resize();
    animate();

    // Global Mouse & Touch Interaction (Mobile support)
    window.addEventListener('mousemove', (e) => {
        targetMouse.x = e.clientX;
        targetMouse.y = e.clientY;
    });
    
    // Mobil kaydırma (touchmove) desteği
    window.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches.length > 0) {
            targetMouse.x = e.touches[0].clientX;
            targetMouse.y = e.touches[0].clientY;
        }
    });

    // Reset camera on leave
    document.addEventListener('mouseleave', () => {
        targetMouse.x = width / 2;
        targetMouse.y = height / 2;
    });

    // --- Scroll Animations ---
    const scrollElements = document.querySelectorAll('.glass-card');
    anime.set(scrollElements, { opacity: 0, translateY: 50 });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                anime({
                    targets: entry.target,
                    opacity: [0, 1],
                    translateY: [50, 0],
                    easing: 'easeOutExpo',
                    duration: 1000,
                    delay: 200 // Slight delay for smoothness
                });
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    scrollElements.forEach(el => observer.observe(el));

    // Cinematic Warp Speed with GSAP ScrollTrigger
    if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
        gsap.registerPlugin(ScrollTrigger);

        ScrollTrigger.create({
            trigger: "body",
            start: "top top",
            end: "bottom bottom",
            onUpdate: (self) => {
                // When scrolling fast, increase the Z velocity of particles drastically
                const velocity = Math.abs(self.getVelocity());
                window.warpSpeedOffset = Math.min(velocity / 15, 120); // Cap max warp

                // Kill ongoing tweens and ease back to 0
                gsap.killTweensOf(window);
                gsap.to(window, {
                    warpSpeedOffset: 0,
                    duration: 0.8,
                    ease: "power2.out"
                });
            }
        });
    }

});
