// CardNav - Vanilla JS Version with Decrypt Effect
// Expandable card-based navigation

(function () {
    class CardNav {
        constructor(container, options = {}) {
            this.container = container;
            this.options = {
                logo: options.logo || 'Ali Valiyev',
                logoHref: options.logoHref || '#',
                ctaText: options.ctaText || 'İletişim',
                ctaHref: options.ctaHref || '#contact',
                items: options.items || [],
                ease: options.ease || 'power3.out'
            };

            this.isExpanded = false;
            this.navEl = null;
            this.cardsEls = [];
            this.decryptInstances = [];

            this.init();
        }

        init() {
            this.container.classList.add('card-nav-container');
            // Apply magnet effect to entire header
            this.container.setAttribute('data-magnet', '');
            this.container.setAttribute('data-magnet-padding', '80');
            this.container.setAttribute('data-magnet-strength', '6');
            this.render();
            this.setupEvents();
        }

        render() {
            const itemsHTML = this.options.items.map((item, idx) => `
                <div class="nav-card" data-card-index="${idx}" style="background-color: ${item.bgColor}; color: ${item.textColor};">
                    <div class="nav-card-label">${item.label}</div>
                    <div class="nav-card-links">
                        ${item.links.map(link => `
                            <a class="nav-card-link cursor-target" href="${link.href || '#'}" aria-label="${link.ariaLabel || link.label}" data-decrypt-text="${link.label}">
                                ${link.label}
                            </a>
                        `).join('')}
                    </div>
                </div>
            `).join('');

            this.container.innerHTML = `
                <nav class="card-nav">
                    <div class="card-nav-top">
                        <div class="hamburger-menu cursor-target" role="button" aria-label="Menüyü aç" tabindex="0">
                            <div class="hamburger-line"></div>
                            <div class="hamburger-line"></div>
                        </div>
                        
                        <div class="logo-container">
                            <a href="${this.options.logoHref}" class="card-nav-logo cursor-target">
                                ${this.options.logo}<span class="dot">.</span>
                            </a>
                        </div>
                        
                        <a href="${this.options.ctaHref}" class="card-nav-cta-button cursor-target">
                            ${this.options.ctaText}
                        </a>
                    </div>
                    
                    <div class="card-nav-content" aria-hidden="true">
                        ${itemsHTML}
                    </div>
                </nav>
            `;

            this.navEl = this.container.querySelector('.card-nav');
            this.hamburger = this.container.querySelector('.hamburger-menu');
            this.content = this.container.querySelector('.card-nav-content');
            this.cardsEls = Array.from(this.container.querySelectorAll('.nav-card'));
            this.linkEls = Array.from(this.container.querySelectorAll('.nav-card-link'));

            // Initial state
            gsap.set(this.navEl, { height: 60, overflow: 'hidden' });
            gsap.set(this.cardsEls, { y: 30, opacity: 0 });

            // Initialize magnet effects on header elements
            if (typeof initMagnets === 'function') {
                setTimeout(initMagnets, 100);
            }
        }

        calculateHeight() {
            const isMobile = window.matchMedia('(max-width: 768px)').matches;
            if (isMobile) {
                const cardHeight = 120; /* Increased from 80 to ensure full visibility */
                const gap = 8;
                const padding = 16;
                const topBar = 60;
                return topBar + (this.cardsEls.length * cardHeight) + ((this.cardsEls.length - 1) * gap) + padding;
            }
            return 280;
        }

        setupEvents() {
            this.hamburger.addEventListener('click', () => this.toggle());
            this.hamburger.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.toggle();
                }
            });

            document.addEventListener('click', (e) => {
                if (this.isExpanded && !this.container.contains(e.target)) {
                    this.close();
                }
            });

            window.addEventListener('resize', () => {
                if (this.isExpanded) {
                    gsap.to(this.navEl, {
                        height: this.calculateHeight(),
                        duration: 0.3,
                        ease: this.options.ease
                    });
                }
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.isExpanded) {
                    this.close();
                }
            });
        }

        toggle() {
            if (this.isExpanded) {
                this.close();
            } else {
                this.open();
            }
        }

        // Decrypt animation for links - SLOWER version
        animateDecrypt(element, text) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*';
            const speed = 80; // Slower speed (was 30)
            let iteration = 0;
            const maxIterations = text.length;

            const interval = setInterval(() => {
                element.textContent = text.split('').map((char, idx) => {
                    if (idx < iteration) return char;
                    if (char === ' ') return ' ';
                    return chars[Math.floor(Math.random() * chars.length)];
                }).join('');

                iteration += 0.25; // Slower reveal (was 0.5)
                if (iteration >= maxIterations) {
                    clearInterval(interval);
                    element.textContent = text;
                }
            }, speed);
        }

        open() {
            this.isExpanded = true;
            this.hamburger.classList.add('open');
            this.navEl.classList.add('open');
            this.hamburger.setAttribute('aria-label', 'Menüyü kapat');
            this.content.setAttribute('aria-hidden', 'false');

            gsap.to(this.navEl, {
                height: this.calculateHeight(),
                duration: 0.4,
                ease: this.options.ease
            });

            gsap.to(this.cardsEls, {
                y: 0,
                opacity: 1,
                duration: 0.4,
                ease: this.options.ease,
                stagger: 0.08,
                delay: 0.1
            });

            // Trigger decrypt animation on links
            setTimeout(() => {
                this.linkEls.forEach((link, idx) => {
                    const originalText = link.dataset.decryptText || link.textContent.trim();
                    setTimeout(() => {
                        this.animateDecrypt(link, originalText);
                    }, idx * 50);
                });
            }, 200);
        }

        close() {
            this.isExpanded = false;
            this.hamburger.classList.remove('open');
            this.hamburger.setAttribute('aria-label', 'Menüyü aç');
            this.content.setAttribute('aria-hidden', 'true');

            gsap.to(this.cardsEls, {
                y: 30,
                opacity: 0,
                duration: 0.3,
                ease: this.options.ease,
                stagger: 0.05,
                onComplete: () => {
                    this.navEl.classList.remove('open');
                }
            });

            gsap.to(this.navEl, {
                height: 60,
                duration: 0.4,
                ease: this.options.ease,
                delay: 0.1
            });
        }
    }

    window.CardNav = CardNav;

    function initCardNav() {
        const container = document.getElementById('card-nav');
        if (!container) return;

        new CardNav(container, {
            logo: 'ALI VALIYEV',
            logoHref: 'index.html',
            ctaText: 'İLETİŞİM',
            ctaHref: 'contact.html',
            items: [
                {
                    label: 'ANA SAYFA',
                    bgColor: 'rgba(30, 30, 30, 0.95)',
                    textColor: '#fff',
                    links: [
                        { label: 'ANASAYFA', href: 'index.html' }
                    ]
                },
                {
                    label: 'HAKKIMDA',
                    bgColor: 'rgba(35, 35, 35, 0.95)',
                    textColor: '#fff',
                    links: [
                        { label: 'PROFİL', href: 'about.html' },
                        { label: 'YETENEKLER', href: 'about.html#skills' }
                    ]
                },
                {
                    label: 'PROJELER',
                    bgColor: 'rgba(40, 40, 40, 0.95)',
                    textColor: '#fff',
                    links: [
                        { label: 'TÜM PROJELER', href: 'projects.html' },
                        { label: 'DETAYLI GÖRÜNÜM', href: 'project-detail.html' }
                    ]
                }
            ]
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCardNav);
    } else {
        initCardNav();
    }
})();
