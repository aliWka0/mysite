
document.addEventListener('DOMContentLoaded', function () {

    // Elements to animate
    const loadingScreen = document.getElementById('loading-screen');

    // Parent wrapper
    const animationWrapper = document.querySelector('.animation-wrapper');

    // Specific Children
    const particlesCanvas = document.querySelector('.stagger-visualizer');

    const cardNav = document.getElementById('card-nav'); // Header/Nav
    const heroSection = document.querySelector('.hero'); // Main content
    const techBanner = document.querySelector('.tech-banner');
    const footer = document.querySelector('footer');

    // Initially hide elements if we are going to show the loader
    // We need to check session storage first to see if we should run loader
    const shouldRunLoader = !sessionStorage.getItem('portfolio_visited');

    if (shouldRunLoader) {

        // Ensure parent wrapper is visible, but hide children
        if (animationWrapper) {
            animationWrapper.style.opacity = '1';
        }

        // Hide Particles
        if (particlesCanvas) {
            particlesCanvas.style.opacity = '0';
            particlesCanvas.style.transition = 'opacity 2s ease';
        }

        // Hide Header & Content
        if (cardNav) {
            cardNav.style.opacity = '0';
            cardNav.style.transition = 'opacity 1.5s ease';
        }

        if (heroSection) {
            heroSection.style.opacity = '0';
            heroSection.style.transition = 'opacity 1.5s ease';
        }

        if (techBanner) {
            techBanner.style.opacity = '0';
            techBanner.style.transition = 'opacity 1.5s ease';
        }

        if (footer) {
            footer.style.opacity = '0';
            footer.style.transition = 'opacity 1.5s ease';
        }

        // Hide Lightning (Initially set intensity to 0)
        // We use the new exposed method if available, and also standard opacity for safety
        if (window.setLightningIntensity) {
            window.setLightningIntensity(0);
        }

        // We still keep the CSS opacity hiding as a fallback/layer
        const style = document.createElement('style');
        style.id = 'lightning-hide-style';
        style.innerHTML = '.lightning-container { opacity: 0; transition: opacity 2s ease; }';
        document.head.appendChild(style);

        // Set visited flag
        sessionStorage.setItem('portfolio_visited', 'true');

        // 1. Initialize Noise for Loader
        if (window.Noise && loadingScreen) {
            new Noise({
                patternAlpha: 40,
                container: loadingScreen
            });
        }

        // 2. Text Animation Logic
        const loaderText = document.getElementById('loader-text');

        if (loaderText) {
            const baseText = "Yükleniyor";
            const chars = "/";
            let count = 0;
            const maxSlashes = 10;

            const interval = setInterval(() => {
                count++;
                let slashes = "".padEnd(count, chars);
                loaderText.textContent = `${baseText} ${slashes}`;

                if (count >= maxSlashes) {
                    clearInterval(interval);

                    // Finish Loader
                    setTimeout(() => {
                        // Fade out loader
                        loadingScreen.style.transition = 'opacity 1s ease';
                        loadingScreen.style.opacity = '0';

                        setTimeout(() => {
                            loadingScreen.style.display = 'none';

                            // START STAGGERED ENTRANCE SEQUENCE

                            // 1. Background Particles FIRST
                            if (particlesCanvas) particlesCanvas.style.opacity = '1';

                            setTimeout(() => {
                                // 2. Lightning (1.3s later) - Animate Intensity
                                const lightningCanvas = document.querySelector('.lightning-container');
                                if (lightningCanvas) {
                                    lightningCanvas.style.opacity = '1';
                                }
                                const hideStyle = document.getElementById('lightning-hide-style');
                                if (hideStyle) {
                                    hideStyle.innerHTML = '.lightning-container { opacity: 1; transition: opacity 2s ease; }';
                                }

                                // Animate Intensity from 0 to 0.6 (default)
                                if (window.setLightningIntensity) {
                                    let intensity = 0;
                                    const targetIntensity = 0.6;
                                    const duration = 2000; // 2 seconds
                                    const startTime = performance.now();

                                    function animateIntensity(currentTime) {
                                        const elapsed = currentTime - startTime;
                                        if (elapsed < duration) {
                                            // Ease in (quadratic)
                                            const t = elapsed / duration;
                                            intensity = targetIntensity * (t * t);
                                            window.setLightningIntensity(intensity);
                                            requestAnimationFrame(animateIntensity);
                                        } else {
                                            window.setLightningIntensity(targetIntensity);
                                        }
                                    }
                                    requestAnimationFrame(animateIntensity);
                                }

                                setTimeout(() => {
                                    // 3. Header / Nav (1.3s later)
                                    if (cardNav) cardNav.style.opacity = '1';

                                    setTimeout(() => {
                                        // 4. Hero & Content (1.3s later)
                                        if (heroSection) heroSection.style.opacity = '1';
                                        if (techBanner) techBanner.style.opacity = '1';
                                        if (footer) footer.style.opacity = '1';

                                    }, 1300);
                                }, 1300);
                            }, 1300);

                        }, 1000);
                    }, 300);
                }
            }, 100);
        }
    } else {
        // If already visited, ensure everything is visible and loader is gone
        if (loadingScreen) loadingScreen.style.display = 'none';
    }
});
