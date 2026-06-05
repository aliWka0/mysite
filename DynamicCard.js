/**
 * DynamicCard - 3D Tilt and Dynamic Glow Effect
 * Applies a mouse-following glow and 3D tilt effect to elements (like .glass-card)
 */
class DynamicCard {
    constructor(elements) {
        this.cards = typeof elements === 'string' ? document.querySelectorAll(elements) : elements;
        this.init();
    }

    init() {
        this.cards.forEach(card => {
            // Setup DOM structure for glow if not already present
            if (!card.querySelector('.glow-effect')) {
                const glow = document.createElement('div');
                glow.className = 'glow-effect';
                card.appendChild(glow);
            }

            // Ensure card has relative positioning for the absolute glow
            if (window.getComputedStyle(card).position === 'static') {
                card.style.position = 'relative';
            }
            
            // Allow 3D transforms
            card.style.transformStyle = 'preserve-3d';
            card.style.transition = 'transform 0.1s ease, box-shadow 0.1s ease';

            // Event Listeners
            card.addEventListener('mousemove', (e) => this.handleMouseMove(e, card));
            card.addEventListener('mouseleave', (e) => this.handleMouseLeave(e, card));
            card.addEventListener('mouseenter', (e) => this.handleMouseEnter(e, card));
        });
    }

    handleMouseMove(e, card) {
        const rect = card.getBoundingClientRect();
        
        // Mouse position relative to the card
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Normalize coordinates for 3D tilt (-1 to 1)
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        const rotateX = ((y - centerY) / centerY) * -5; // Max tilt 5 degrees
        const rotateY = ((x - centerX) / centerX) * 5;

        // Apply glow position
        card.style.setProperty('--mouse-x', `${x}px`);
        card.style.setProperty('--mouse-y', `${y}px`);

        // Apply 3D Transform using GSAP if available, otherwise fallback to vanilla
        if (typeof gsap !== 'undefined') {
            gsap.to(card, {
                duration: 0.4,
                rotateX: rotateX,
                rotateY: rotateY,
                transformPerspective: 1000,
                ease: 'power2.out'
            });
        } else {
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
        }
    }

    handleMouseLeave(e, card) {
        // Reset 3D rotation
        if (typeof gsap !== 'undefined') {
            gsap.to(card, {
                duration: 0.7,
                rotateX: 0,
                rotateY: 0,
                ease: 'power3.out'
            });
        } else {
            card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg)`;
        }
    }
    
    handleMouseEnter(e, card) {
        // Just ensures the transition is smooth when re-entering
    }
}

// Auto init on DOM ready for all .glass-card elements
document.addEventListener('DOMContentLoaded', () => {
    // Wait a brief moment to ensure all cards (even dynamically added ones) are present
    setTimeout(() => {
        new DynamicCard('.glass-card');
    }, 100);
});
