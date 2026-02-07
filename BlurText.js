// BlurText - Vanilla JS Version (converted from React)
// Scroll-triggered blur text animation

(function () {
    const defaultConfig = {
        delay: 50,
        animateBy: 'words',
        direction: 'top',
        threshold: 0.1,
        rootMargin: '0px',
        duration: 0.5,
        initialDelay: 100
    };

    function initBlurText() {
        const elements = document.querySelectorAll('[data-blur-text]');

        elements.forEach((element, elementIndex) => {
            if (element.dataset.blurProcessed) return;
            element.dataset.blurProcessed = 'true';

            const config = {
                delay: parseInt(element.dataset.blurDelay) || defaultConfig.delay,
                animateBy: element.dataset.blurAnimateBy || defaultConfig.animateBy,
                direction: element.dataset.blurDirection || defaultConfig.direction,
                threshold: parseFloat(element.dataset.blurThreshold) || defaultConfig.threshold,
                rootMargin: element.dataset.blurRootMargin || defaultConfig.rootMargin,
                duration: parseFloat(element.dataset.blurDuration) || defaultConfig.duration
            };

            // Get original text and normalize whitespace
            const text = element.textContent.trim().replace(/\s+/g, ' ');

            if (!text) return;

            // Split text into words
            const words = text.split(' ').filter(w => w.length > 0);

            // Clear element and add class
            element.innerHTML = '';
            element.classList.add('blur-text-container');

            // Create word spans with spaces between them
            words.forEach((word, index) => {
                const span = document.createElement('span');
                span.className = `blur-text-word from-${config.direction}`;
                span.textContent = word;
                span.style.transitionDuration = `${config.duration}s`;
                span.style.transitionDelay = `${index * config.delay}ms`;

                element.appendChild(span);

                // Add text node for space (not &nbsp;)
                if (index < words.length - 1) {
                    element.appendChild(document.createTextNode(' '));
                }
            });

            // Check if element is in viewport
            const rect = element.getBoundingClientRect();
            const isInViewport = rect.top < window.innerHeight && rect.bottom > 0;

            if (isInViewport) {
                const baseDelay = defaultConfig.initialDelay + (elementIndex * 50);
                setTimeout(() => {
                    const wordSpans = element.querySelectorAll('.blur-text-word');
                    wordSpans.forEach(word => {
                        word.classList.add('animate-in');
                    });
                }, baseDelay);
            } else {
                const observer = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            const wordSpans = element.querySelectorAll('.blur-text-word');
                            wordSpans.forEach(word => {
                                word.classList.add('animate-in');
                            });
                            observer.unobserve(element);
                        }
                    });
                }, {
                    threshold: config.threshold,
                    rootMargin: config.rootMargin
                });

                observer.observe(element);
            }
        });
    }

    window.BlurText = { init: initBlurText };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBlurText);
    } else {
        setTimeout(initBlurText, 50);
    }
})();
