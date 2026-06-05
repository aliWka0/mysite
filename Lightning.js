// Lightning - Vanilla JS Version (converted from React)
// WebGL-based lightning/electrical effect for background

(function () {
    // Configuration - adapts to black/gray/white theme
    const config = {
        hue: 0,           // 0 = white/gray lightning (monochrome theme)
        xOffset: 0,
        speed: 0.4,       // Daha yumuşak hareket için yavaşlatıldı (eski değer: 0.7)
        intensity: 0.6,   // Işık gücü tekrar artırıldı
        size: 2
    };

    // Expose control to window for Loader.js
    window.setLightningIntensity = function (value) {
        config.intensity = value;
    };

    function initLightning() {
        const wrapper = document.querySelector('.animation-wrapper');
        if (!wrapper) return;

        // Create canvas element
        const canvas = document.createElement('canvas');
        canvas.className = 'lightning-container';
        wrapper.insertBefore(canvas, wrapper.firstChild);

        const resizeCanvas = () => {
            canvas.width = canvas.clientWidth || window.innerWidth;
            canvas.height = canvas.clientHeight || window.innerHeight;
        };
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        const gl = canvas.getContext('webgl');
        if (!gl) {
            console.error('WebGL not supported');
            return;
        }

        const vertexShaderSource = `
            attribute vec2 aPosition;
            void main() {
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;

        const fragmentShaderSource = `
            precision mediump float;
            uniform vec2 iResolution;
            uniform float iTime;
            uniform float uHue;
            uniform float uXOffset;
            uniform float uSpeed;
            uniform float uIntensity;
            uniform float uSize;
            uniform float uDistortion;
            uniform vec2 uMouse;
            uniform float uWarp;
            
            #define OCTAVE_COUNT 10

            vec3 hsv2rgb(vec3 c) {
                vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
                return c.z * mix(vec3(1.0), rgb, c.y);
            }

            float hash11(float p) {
                p = fract(p * .1031);
                p *= p + 33.33;
                p *= p + p;
                return fract(p);
            }

            float hash12(vec2 p) {
                vec3 p3 = fract(vec3(p.xyx) * .1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }

            mat2 rotate2d(float theta) {
                float c = cos(theta);
                float s = sin(theta);
                return mat2(c, -s, s, c);
            }

            float noise(vec2 p) {
                vec2 ip = floor(p);
                vec2 fp = fract(p);
                float a = hash12(ip);
                float b = hash12(ip + vec2(1.0, 0.0));
                float c = hash12(ip + vec2(0.0, 1.0));
                float d = hash12(ip + vec2(1.0, 1.0));
                
                vec2 t = smoothstep(0.0, 1.0, fp);
                return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
            }

            float fbm(vec2 p) {
                float value = 0.0;
                float amplitude = 0.5;
                for (int i = 0; i < OCTAVE_COUNT; ++i) {
                    value += amplitude * noise(p);
                    p *= rotate2d(0.45);
                    p *= 2.0;
                    amplitude *= 0.5;
                }
                return value;
            }

            void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
                vec2 uv = fragCoord / iResolution.xy;
                uv = 2.0 * uv - 1.0;
                uv.x *= iResolution.x / iResolution.y;
                uv.x += uXOffset;
                
                // MOUSE INTERACTION (Fare Etkileşimi)
                // Şekli kırıp bozmak yerine fareye yakın yerlerde enerji dalgalanmasını/bozulmasını artırır
                float mouseXAspect = uMouse.x * (iResolution.x / iResolution.y);
                float mouseDist = distance(vec2(uv.x, uv.y), vec2(mouseXAspect, uMouse.y));
                float mouseAura = exp(-2.5 * mouseDist); // Fareye olan yakınlık (yumuşak düşüş)
                
                // Şekli bozmayacak kadar çok çok hafif, organik bir çekim
                uv.x += (uv.x - mouseXAspect) * mouseAura * -0.05;
                
                // NOISE & WARP DISTORTION (Aşırı Yüklenme Distorsiyonu)
                // Fare yakınlığında (mouseAura) noise distorsiyonunu (çırpınmayı) artır
                float warpDistort = uDistortion + (uWarp * 0.01) + (mouseAura * 0.5);
                vec2 fbmUV = uv * uSize + 0.8 * iTime * uSpeed;
                uv += warpDistort * fbm(fbmUV) - (warpDistort * 0.5);
                
                float dist = abs(uv.x);
                
                // BRANCHING (Çatallanma ve Kökler)
                float dist2 = abs(uv.x + 0.4 * fbm(fbmUV * 2.0 + 10.0) - 0.2);
                float dist3 = abs(uv.x - 0.5 * fbm(fbmUV * 1.5 - 5.0) + 0.25);
                
                // Monochrome version for black/white theme
                vec3 baseColor;
                if (uHue < 1.0) {
                    baseColor = vec3(0.9, 0.9, 0.95);
                } else {
                    baseColor = hsv2rgb(vec3(uHue / 360.0, 0.7, 0.8));
                }
                
                // OVERLOAD INTENSITY (Scroll Aşırı Yüklenmesi)
                // Kaydırma anındaki patlamayı daha naif ve akıcı yaptık (çarpanları kıstık)
                float currentIntensity = uIntensity * (1.0 + uWarp * 0.005 + mouseAura * 0.2); // Farenin altında hafif aydınlanma
                
                // Titremeyi önleyen sabit ışık kalınlığı ve dalların birleştirilmesi
                float lightThickness = 0.05 + (uWarp * 0.0002); // Warp anında sadece çok hafif kalınlaşır
                float core = lightThickness / dist;
                float branch1 = (lightThickness * 0.3) / dist2; 
                float branch2 = (lightThickness * 0.2) / dist3;
                
                vec3 col = baseColor * (core + branch1 + branch2) * currentIntensity;
                col = pow(col, vec3(1.0));
                fragColor = vec4(col, 1.0);
            }

            void main() {
                mainImage(gl_FragColor, gl_FragCoord.xy);
            }
        `;

        const compileShader = (source, type) => {
            const shader = gl.createShader(type);
            if (!shader) return null;
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error('Shader compile error:', gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        };

        const vertexShader = compileShader(vertexShaderSource, gl.VERTEX_SHADER);
        const fragmentShader = compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
        if (!vertexShader || !fragmentShader) return;

        const program = gl.createProgram();
        if (!program) return;
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program linking error:', gl.getProgramInfoLog(program));
            return;
        }
        gl.useProgram(program);

        const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        const aPosition = gl.getAttribLocation(program, 'aPosition');
        gl.enableVertexAttribArray(aPosition);
        gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

        const iResolutionLocation = gl.getUniformLocation(program, 'iResolution');
        const iTimeLocation = gl.getUniformLocation(program, 'iTime');
        const uHueLocation = gl.getUniformLocation(program, 'uHue');
        const uXOffsetLocation = gl.getUniformLocation(program, 'uXOffset');
        const uSpeedLocation = gl.getUniformLocation(program, 'uSpeed');
        const uIntensityLocation = gl.getUniformLocation(program, 'uIntensity');
        const uSizeLocation = gl.getUniformLocation(program, 'uSize');
        const uDistortionLocation = gl.getUniformLocation(program, 'uDistortion');
        const uMouseLocation = gl.getUniformLocation(program, 'uMouse');
        const uWarpLocation = gl.getUniformLocation(program, 'uWarp');

        const startTime = performance.now();
        let animationId;

        // Mouse tracking for magnetic effect
        let targetMouseX = 0;
        let targetMouseY = 0;
        let currentMouseX = 0;
        let currentMouseY = 0;

        window.addEventListener('mousemove', (e) => {
            targetMouseX = (e.clientX / window.innerWidth) * 2 - 1;
            targetMouseY = -(e.clientY / window.innerHeight) * 2 + 1;
        });

        // Mobile touch support
        window.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) {
                targetMouseX = (e.touches[0].clientX / window.innerWidth) * 2 - 1;
                targetMouseY = -(e.touches[0].clientY / window.innerHeight) * 2 + 1;
            }
        });

        window.addEventListener('touchstart', (e) => {
            if (e.touches.length > 0) {
                targetMouseX = (e.touches[0].clientX / window.innerWidth) * 2 - 1;
                targetMouseY = -(e.touches[0].clientY / window.innerHeight) * 2 + 1;
                // Anında tepki vermesi için (yumuşatma olmadan) ilk dokunuşta direkt zıpla
                currentMouseX = targetMouseX;
                currentMouseY = targetMouseY;
            }
        });

        const render = () => {
            resizeCanvas();
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.uniform2f(iResolutionLocation, canvas.width, canvas.height);
            const currentTime = performance.now();
            gl.uniform1f(iTimeLocation, (currentTime - startTime) / 1000.0);
            gl.uniform1f(uHueLocation, config.hue);
            gl.uniform1f(uXOffsetLocation, config.xOffset);
            gl.uniform1f(uSpeedLocation, config.speed);
            gl.uniform1f(uIntensityLocation, config.intensity);
            gl.uniform1f(uSizeLocation, config.size);

            // Adjust distortion based on aspect ratio/device
            // On mobile (narrow screen), reduce distortion to keep lightning visible
            const isMobile = canvas.width < 768;
            const distortion = isMobile ? 1.0 : 2.0;
            gl.uniform1f(uDistortionLocation, distortion);

            gl.drawArrays(gl.TRIANGULAR, 0, 6);
            animationId = requestAnimationFrame(render);
        };

        // Fix: TRIANGLES not TRIANGULAR
        const renderFixed = () => {
            resizeCanvas();
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.uniform2f(iResolutionLocation, canvas.width, canvas.height);
            const currentTime = performance.now();
            gl.uniform1f(iTimeLocation, (currentTime - startTime) / 1000.0);
            gl.uniform1f(uHueLocation, config.hue);
            gl.uniform1f(uXOffsetLocation, config.xOffset);
            gl.uniform1f(uSpeedLocation, config.speed);
            gl.uniform1f(uIntensityLocation, config.intensity);
            gl.uniform1f(uSizeLocation, config.size);

            const isMobile = canvas.width < 768;
            const distortion = isMobile ? 1.0 : 2.0;
            gl.uniform1f(uDistortionLocation, distortion);

            // Smooth mouse easing
            currentMouseX += (targetMouseX - currentMouseX) * 0.1;
            currentMouseY += (targetMouseY - currentMouseY) * 0.1;
            
            gl.uniform2f(uMouseLocation, currentMouseX, currentMouseY);
            
            // Warp overload from scroll (defined in script.js)
            gl.uniform1f(uWarpLocation, window.warpSpeedOffset || 0);

            gl.drawArrays(gl.TRIANGLES, 0, 6);
            animationId = requestAnimationFrame(renderFixed);
        };

        animationId = requestAnimationFrame(renderFixed);

        // Cleanup function (not used in this vanilla version but available)
        window.LightningCleanup = () => {
            cancelAnimationFrame(animationId);
            window.removeEventListener('resize', resizeCanvas);
        };
    }

    // Auto-initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLightning);
    } else {
        initLightning();
    }
})();
