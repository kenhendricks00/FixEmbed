document.addEventListener('DOMContentLoaded', function () {
    // ===================================
    // SMOOTH SCROLLING
    // ===================================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();

            const targetId = this.getAttribute('href');
            if (targetId === '#') return;

            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                const headerOffset = 80;
                const elementPosition = targetElement.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    // ===================================
    // SCROLL REVEAL ANIMATIONS
    // ===================================
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Apply to all animatable cards with staggered delay
    const animatableElements = document.querySelectorAll(
        '.feature-card, .platform-card, .support-card, .step, .credit-link'
    );

    animatableElements.forEach((element, index) => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(30px)';
        element.style.transition = `opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1) ${index % 6 * 0.1}s, 
                                    transform 0.6s cubic-bezier(0.4, 0, 0.2, 1) ${index % 6 * 0.1}s`;
        revealObserver.observe(element);
    });

    // ===================================
    // HERO IMAGE PARALLAX EFFECT
    // ===================================
    const heroImage = document.querySelector('.hero-image img, .hero-image-mobile img');

    if (heroImage) {
        window.addEventListener('scroll', () => {
            const scrolled = window.pageYOffset;
            const rate = scrolled * 0.15;

            if (scrolled < 800) {
                heroImage.style.transform = `translateY(${rate}px)`;
            }
        });
    }

    // ===================================
    // FLOATING SHAPES MOUSE INTERACTION
    // ===================================
    const shapes = document.querySelectorAll('.shape');
    let mouseX = 0;
    let mouseY = 0;
    let currentX = 0;
    let currentY = 0;

    document.addEventListener('mousemove', (e) => {
        mouseX = (e.clientX / window.innerWidth - 0.5) * 30;
        mouseY = (e.clientY / window.innerHeight - 0.5) * 30;
    });

    function animateShapes() {
        currentX += (mouseX - currentX) * 0.05;
        currentY += (mouseY - currentY) * 0.05;

        shapes.forEach((shape, index) => {
            const factor = (index + 1) * 0.3;
            shape.style.transform = `translate(${currentX * factor}px, ${currentY * factor}px)`;
        });

        requestAnimationFrame(animateShapes);
    }

    if (shapes.length > 0) {
        animateShapes();
    }

    // ===================================
    // BUTTON RIPPLE EFFECT
    // ===================================
    document.querySelectorAll('.primary-btn, .secondary-btn, .invite-btn').forEach(button => {
        button.addEventListener('click', function (e) {
            const rect = button.getBoundingClientRect();
            const ripple = document.createElement('span');

            ripple.style.cssText = `
                position: absolute;
                background: rgba(255, 255, 255, 0.3);
                border-radius: 50%;
                pointer-events: none;
                transform: scale(0);
                animation: ripple 0.6s ease-out;
            `;

            const size = Math.max(rect.width, rect.height);
            ripple.style.width = ripple.style.height = size + 'px';
            ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
            ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';

            button.style.position = 'relative';
            button.style.overflow = 'hidden';
            button.appendChild(ripple);

            ripple.addEventListener('animationend', () => ripple.remove());
        });
    });

    // Add ripple animation keyframes
    const style = document.createElement('style');
    style.textContent = `
        @keyframes ripple {
            to {
                transform: scale(4);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);

    // ===================================
    // NAVBAR SCROLL EFFECT
    // ===================================
    const nav = document.querySelector('nav');
    let lastScroll = 0;

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;

        if (currentScroll > 100) {
            nav.style.background = 'rgba(13, 17, 23, 0.95)';
            nav.style.boxShadow = '0 4px 30px rgba(0, 0, 0, 0.3)';
        } else {
            nav.style.background = 'rgba(13, 17, 23, 0.8)';
            nav.style.boxShadow = 'none';
        }

        lastScroll = currentScroll;
    });

    // ===================================
    // TYPING EFFECT FOR HERO (Optional enhancement)
    // ===================================
    const gradientText = document.querySelector('.hero-content .gradient-text, .hero-mobile .gradient-text');

    if (gradientText) {
        gradientText.style.opacity = '0';
        gradientText.style.animation = 'fadeInScale 0.8s ease-out 0.3s forwards';

        const additionalStyle = document.createElement('style');
        additionalStyle.textContent = `
            @keyframes fadeInScale {
                from {
                    opacity: 0;
                    transform: scale(0.9);
                }
                to {
                    opacity: 1;
                    transform: scale(1);
                }
            }
        `;
        document.head.appendChild(additionalStyle);
    }

    // ===================================
    // LOGO GLOW PULSE
    // ===================================
    const logoImg = document.querySelector('.logo-img');

    if (logoImg) {
        setInterval(() => {
            logoImg.style.boxShadow = '0 0 30px rgba(88, 101, 242, 0.6)';
            setTimeout(() => {
                logoImg.style.boxShadow = '0 0 20px rgba(88, 101, 242, 0.4)';
            }, 1000);
        }, 3000);
    }
});
