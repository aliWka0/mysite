document.addEventListener('DOMContentLoaded', () => {

    // --- Hero Animation: Antigravity 3D Particle Cloud ---
    const canvas = document.querySelector('.stagger-visualizer');
    const ctx = canvas.getContext('2d');

    // 3D Configuration
    const particleCount = 800; // Kar yağışı yoğunluğu için artırıldı
    const focalLength = 400;
    const depth = 2000;

    let particles = [];
    let mouse = { x: 0, y: 0 };
    let targetMouse = { x: 0, y: 0 }; // For smooth easing
    let width, height;
    let clickPulse = 0; // Tıklama ile oluşan şok dalgası enerjisi
    window.warpSpeedOffset = 0; // Cinematic scroll speed multiplier

    // Tıklama etkileri kaldırıldı

    function resize() {
        // Set canvas to full screen/window size to ensure global coverage
        const wrapper = document.querySelector('.animation-wrapper');
        width = canvas.width = wrapper.offsetWidth; // Should match window width if fixed
        height = canvas.height = wrapper.offsetHeight;
        initParticles();
    }

    class Particle {
        constructor() {
            this.reset(true);
        }

        reset(init = false) {
            this.x = Math.random() * width;
            this.y = init ? Math.random() * height : -20;
            this.z = Math.random() * depth;
            
            // Minimal, göz yormayan kar tanesi boyutu (1px ile 3px arası)
            this.size = Math.random() * 2 + 1;
            
            // Derinlik oranı (1 = yakın, 0 = uzak)
            const depthRatio = 1 - (this.z / depth);
            
            // Kar tanelerinin düşme hızları: yakındakiler daha hızlı, uzaktakiler yavaş süzülür
            this.velY = (Math.random() * 0.8 + 0.4) * (depthRatio * 1.5 + 0.5);
            // Hafif yan sallantı/rüzgar etkisi
            this.velX = (Math.random() - 0.5) * 0.3;
        }

        update() {
            // Aşağı doğru süzülme
            this.y += this.velY;
            // Rüzgar ve sinüs dalgalı salınım
            this.x += this.velX + Math.sin(this.y * 0.01) * 0.1;

            // Ekranın altına indiğinde veya kenarlardan çok taştığında üstten yeniden doğur
            if (this.y > height + 20 || this.x > width + 20 || this.x < -20) {
                this.reset(false);
            }
        }

        draw(ctx) {
            const depthRatio = Math.max(0, 1 - (this.z / depth));
            
            // Uzaktaki parçacıklar daha şeffaf (loş), yakındakiler daha belirgin
            ctx.globalAlpha = Math.max(0.2, depthRatio * 0.85);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
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
