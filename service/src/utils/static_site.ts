
export const indexHtml = `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FixEmbed - Fix Discord Embeds for Social Media</title>
    <meta name="description"
        content="FixEmbed is a Discord bot that fixes the lack of embed support for Twitter, Instagram, Reddit, Threads, Pixiv, Bluesky, and more.">

    <!-- Open Graph / Discord Embed -->
    <meta property="og:type" content="website">
    <meta property="og:title" content="FixEmbed - Fix Discord Embeds for Social Media">
    <meta property="og:description"
        content="A Discord bot that fixes broken embeds from Twitter/X, Instagram, Reddit, Threads, Pixiv, Bluesky, Bilibili, and more. Get rich video previews directly in Discord!">
    <meta property="og:image"
        content="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/OG.png">
    <meta property="og:url" content="https://fixembed.app">
    <meta property="og:site_name" content="FixEmbed">
    <meta name="theme-color" content="#7c3aed">

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="FixEmbed - Fix Discord Embeds for Social Media">
    <meta name="twitter:description"
        content="A Discord bot that fixes broken embeds from Twitter/X, Instagram, Reddit, Threads, Pixiv, Bluesky, Bilibili, and more.">
    <meta name="twitter:image"
        content="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/OG.png">

    <link rel="icon" href="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/logo.png"
        type="image/png">
    <link rel="shortcut icon"
        href="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/logo.png"
        type="image/png">
    <!-- Prevent dark mode extensions from modifying styles -->
    <meta name="color-scheme" content="dark">
    <meta name="darkreader-lock">
    <style>
        /* Critical CSS to prevent FOUC */
        html, body { background-color: #0d1117; }
        body { opacity: 0; transition: opacity 0.1s ease-in; }
        body.loaded { opacity: 1; }
    </style>
    <link rel="stylesheet" href="/styles.css" onload="document.body.classList.add('loaded')">
    <noscript><style>body { opacity: 1; }</style></noscript>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>

<body>
    <!-- Animated Background Shapes -->
    <div class="floating-shapes">
        <div class="shape shape-1"></div>
        <div class="shape shape-2"></div>
        <div class="shape shape-3"></div>
        <div class="shape shape-4"></div>
    </div>

    <header>
        <nav>
            <div class="container">
                <div class="nav-container">
                    <a href="#" class="logo">
                        <img src="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/logo.png"
                            alt="FixEmbed Logo" class="logo-img">
                        <span>FixEmbed</span>
                    </a>
                    <div class="nav-links">
                        <a href="#features">Features</a>
                        <a href="/docs">Docs</a>
                        <a href="#platforms">Platforms</a>
                        <a href="/support">Support</a>
                        <a href="https://github.com/kenhendricks00/FixEmbed" class="github-link" target="_blank">
                            <i class="fab fa-github"></i>
                        </a>
                    </div>
                    <a href="https://discord.com/oauth2/authorize?client_id=1173820242305224764" class="invite-btn"
                        target="_blank">Invite Bot</a>
                </div>
            </div>
        </nav>

        <div class="hero-section">
            <div class="container">
                <!-- Desktop layout wrapper -->
                <div class="hero-desktop">
                    <div class="hero-content">
                        <h1>Fix your Discord embeds with <span class="gradient-text">one bot</span></h1>
                        <p class="subtitle">FixEmbed automatically transforms social media links into beautiful, rich
                            embeds in Discord. No more broken previews.</p>
                        <div class="cta-buttons">
                            <a href="https://discord.com/oauth2/authorize?client_id=1173820242305224764"
                                class="primary-btn" target="_blank">Add to Discord</a>
                            <a href="https://github.com/kenhendricks00/FixEmbed" class="secondary-btn"
                                target="_blank">View on GitHub</a>
                        </div>
                    </div>
                    <div class="hero-image hero-image-desktop">
                        <img src="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/header.png"
                            alt="FixEmbed Discord Bot Preview">
                    </div>
                </div>

                <!-- Mobile layout wrapper (hidden on desktop) -->
                <div class="hero-mobile">
                    <h1>Fix your Discord embeds with <span class="gradient-text">one bot</span></h1>
                    <p class="subtitle">FixEmbed automatically transforms social media links into beautiful, rich embeds
                        in Discord. No more broken previews.</p>
                    <div class="mobile-buttons">
                        <a href="https://discord.com/oauth2/authorize?client_id=1173820242305224764" class="primary-btn"
                            target="_blank">Add to Discord</a>
                        <a href="https://github.com/kenhendricks00/FixEmbed" class="secondary-btn" target="_blank">View
                            on GitHub</a>
                    </div>
                    <div class="hero-image-mobile">
                        <img src="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/header.png"
                            alt="FixEmbed Discord Bot Preview">
                    </div>
                </div>
            </div>
        </div>
    </header>

    <section id="features" class="features-section">
        <div class="container">
            <h2>Why Choose <span class="gradient-text">FixEmbed</span>?</h2>
            <p class="section-subtitle">Everything you need to make your Discord server look amazing with rich embeds
            </p>
            <div class="features-grid">
                <div class="feature-card">
                    <div class="feature-icon"><i class="fas fa-layer-group"></i></div>
                    <h3>Multi-Platform Support</h3>
                    <p>Supports X/Twitter, Instagram, Reddit, Threads, Pixiv, Bluesky, Bilibili, and more to
                        come.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon"><i class="fas fa-user"></i></div>
                    <h3>User-Installable</h3>
                    <p>Install to your personal account and use /fix or right-click context menu anywhere—even in
                        servers without the bot!</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon"><i class="fas fa-sliders-h"></i></div>
                    <h3>Customizable Settings</h3>
                    <p>Easy setup with options to activate or deactivate services per channel or server-wide.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon"><i class="fas fa-bolt"></i></div>
                    <h3>Reliable Performance</h3>
                    <p>Ensures consistent embed functionality across all supported platforms.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon"><i class="fas fa-server"></i></div>
                    <h3>Self-Hosting Option</h3>
                    <p>Easily host the bot yourself using Docker for complete control.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon"><i class="fas fa-globe"></i></div>
                    <h3>Multi-Language Support</h3>
                    <p>Available in 8 languages: English, Spanish, Portuguese, French, German, Japanese, Korean, and
                        Chinese.</p>
                </div>
            </div>
        </div>
    </section>

    <section id="how-it-works" class="how-it-works-section">
        <div class="container">
            <h2>How It <span class="gradient-text">Works</span></h2>
            <p class="section-subtitle">Get started in seconds — it's really that easy</p>
            <div class="steps-container">
                <div class="step">
                    <div class="step-number">1</div>
                    <div class="step-content">
                        <h3>Add FixEmbed to your server or account</h3>
                        <p>Invite the bot to your server, or install it to your personal account for use anywhere.</p>
                    </div>
                </div>
                <div class="step">
                    <div class="step-number">2</div>
                    <div class="step-content">
                        <h3>Share social media links</h3>
                        <p>Post links from X/Twitter, Instagram, Reddit, Threads, Pixiv, Bluesky, or Bilibili.
                        </p>
                    </div>
                </div>
                <div class="step">
                    <div class="step-number">3</div>
                    <div class="step-content">
                        <h3>Watch the magic happen</h3>
                        <p>FixEmbed auto-converts links in servers, or use <code>/fix</code> and right-click → Apps →
                            Fix Embed anywhere!</p>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <section id="platforms" class="platforms-section">
        <div class="container">
            <h2>Supported <span class="gradient-text">Platforms</span></h2>
            <p class="section-subtitle">All your favorite social media sites, fixed for Discord</p>
            <div class="platforms-grid">
                <div class="platform-card">
                    <div class="platform-icon"><i class="fab fa-twitter"></i></div>
                    <h3>X / Twitter</h3>
                    <p>Properly displays tweets with images, videos, and text.</p>
                </div>
                <div class="platform-card">
                    <div class="platform-icon"><i class="fab fa-instagram"></i></div>
                    <h3>Instagram</h3>
                    <p>Shows posts, stories, and reels with full previews.</p>
                </div>
                <div class="platform-card">
                    <div class="platform-icon"><i class="fab fa-reddit"></i></div>
                    <h3>Reddit</h3>
                    <p>Embeds posts and comments with complete formatting.</p>
                </div>
                <div class="platform-card">
                    <div class="platform-icon"><i class="fas fa-comment-dots"></i></div>
                    <h3>Threads</h3>
                    <p>Displays Threads posts with proper media support.</p>
                </div>
                <div class="platform-card">
                    <div class="platform-icon"><i class="fas fa-image"></i></div>
                    <h3>Pixiv</h3>
                    <p>Shows artwork and illustrations with previews.</p>
                </div>
                <div class="platform-card">
                    <div class="platform-icon"><i class="fas fa-cloud"></i></div>
                    <h3>Bluesky</h3>
                    <p>Embeds Bluesky posts with full media support.</p>
                </div>

                <div class="platform-card">
                    <div class="platform-icon"><i class="fas fa-play-circle"></i></div>
                    <h3>Bilibili</h3>
                    <p>Embeds Bilibili videos with full media support.</p>
                </div>
            </div>
        </div>
    </section>

    <section class="cta-section">
        <div class="container">
            <div class="cta-content">
                <h2>Ready to fix your Discord embeds?</h2>
                <p>Add FixEmbed to your server for automatic conversion, or install to your account and use it anywhere!
                </p>
                <a href="https://discord.com/oauth2/authorize?client_id=1173820242305224764" class="primary-btn"
                    target="_blank">Add to Discord</a>
            </div>
        </div>
    </section>

    <section id="hosting" class="hosting-section">
        <div class="container">
            <h2>Host It Yourself</h2>
            <div class="hosting-content">
                <div class="hosting-text">
                    <p>You can easily host FixEmbed yourself using Docker:</p>
                    <div class="code-block">
                        <pre><code>docker pull kenhendricks00/fixembed
docker run -d kenhendricks00/fixembed</code></pre>
                    </div>
                    <p class="note">Don't forget to set your bot's token using the <code>BOT_TOKEN</code> environment
                        variable.</p>
                </div>
            </div>
        </div>
    </section>

    <section id="support" class="support-section">
        <div class="container">
            <h2>Support</h2>
            <div class="support-options">
                <div class="support-card">
                    <div class="support-icon"><i class="fab fa-discord"></i></div>
                    <h3>Discord Server</h3>
                    <p>Join our support server for help and updates.</p>
                    <a href="https://discord.gg/QFxTAmtZdn" class="support-link" target="_blank">Join Server</a>
                </div>
                <div class="support-card">
                    <div class="support-icon"><i class="fab fa-github"></i></div>
                    <h3>GitHub Issues</h3>
                    <p>Report bugs or request features on our GitHub.</p>
                    <a href="https://github.com/kenhendricks00/FixEmbed/issues" class="support-link"
                        target="_blank">Open Issue</a>
                </div>
                <div class="support-card">
                    <div class="support-icon"><i class="fas fa-cog"></i></div>
                    <h3>Debug Info</h3>
                    <p>Use <code>/settings</code> in Discord, then click Debug for technical issues.</p>
                </div>
            </div>
        </div>
    </section>

    <section class="credits-section">
        <div class="container">
            <h2>Credits</h2>
            <p>FixEmbed relies on these amazing services:</p>
            <div class="credits-grid">
                <a href="https://github.com/Lainmode/InstagramEmbed-vxinstagram" class="credit-link" target="_blank">VxInstagram by Lainmode</a>
                <a href="https://snapsave.app" class="credit-link" target="_blank">Snapsave</a>
                <a href="https://github.com/thelaao/phixiv" class="credit-link" target="_blank">Phixiv by thelaao</a>
                <a href="https://github.com/niconi21/vxBilibili" class="credit-link" target="_blank">VxBilibili by niconi21</a>
            </div>
        </div>
    </section>

    <footer>
        <div class="container">
            <div class="footer-content">
                <div class="footer-left">
                    <a href="#" class="footer-logo">FixEmbed</a>
                    <p>A Discord bot that fixes the lack of embed support in Discord.</p>
                </div>
                <div class="footer-right">
                    <div class="footer-links">
                        <a href="/docs">Docs</a>
                        <a href="/tos">Terms</a>
                        <a href="/privacy">Privacy</a>
                        <a href="https://github.com/kenhendricks00/FixEmbed" target="_blank">GitHub</a>
                    </div>
                    <p class="copyright">© 2023-2025 FixEmbed</p>
                </div>
            </div>
        </div>
    </footer>

    <script src="/script.js"></script>
</body>

</html>`;

export const stylesCss = `/* ===================================
   FIXEMBED - DISCORD PREMIUM THEME
   Modern, animated, glassmorphism design
   =================================== */

:root {
    /* Discord-inspired color palette */
    --primary-color: #5865F2;
    --primary-light: #7289DA;
    --primary-glow: rgba(88, 101, 242, 0.4);
    --accent-green: #57F287;
    --accent-yellow: #FEE75C;
    --accent-pink: #EB459E;
    --accent-cyan: #00D4FF;
    
    /* Dark theme backgrounds */
    --bg-primary: #0d1117;
    --bg-secondary: #161b22;
    --bg-tertiary: #21262d;
    --bg-card: rgba(22, 27, 34, 0.8);
    --bg-card-hover: rgba(33, 38, 45, 0.9);
    
    /* Text colors */
    --text-primary: #f0f6fc;
    --text-secondary: #8b949e;
    --text-muted: #6e7681;
    
    /* Effects */
    --glass-border: rgba(255, 255, 255, 0.1);
    --glow-color: rgba(88, 101, 242, 0.5);
    --shadow-color: rgba(0, 0, 0, 0.4);
    
    /* Gradients */
    --gradient-primary: linear-gradient(135deg, #5865F2 0%, #EB459E 50%, #FEE75C 100%);
    --gradient-hero: linear-gradient(135deg, #5865F2 0%, #7289DA 100%);
    --gradient-card: linear-gradient(135deg, rgba(88, 101, 242, 0.1) 0%, rgba(235, 69, 158, 0.1) 100%);
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

html {
    scroll-behavior: smooth;
}

body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    line-height: 1.6;
    color: var(--text-primary);
    background-color: var(--bg-primary);
    overflow-x: hidden;
}

/* ===================================
   ANIMATED BACKGROUND
   =================================== */
.floating-shapes {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
    overflow: hidden;
}

.shape {
    position: absolute;
    border-radius: 50%;
    opacity: 0.15;
    filter: blur(60px);
    animation: float 20s infinite ease-in-out;
}

.shape-1 {
    width: 600px;
    height: 600px;
    background: var(--primary-color);
    top: -10%;
    left: -5%;
    animation-delay: 0s;
}

.shape-2 {
    width: 400px;
    height: 400px;
    background: var(--accent-pink);
    top: 50%;
    right: -10%;
    animation-delay: -5s;
}

.shape-3 {
    width: 500px;
    height: 500px;
    background: var(--accent-cyan);
    bottom: -15%;
    left: 30%;
    animation-delay: -10s;
}

.shape-4 {
    width: 350px;
    height: 350px;
    background: var(--accent-green);
    top: 30%;
    left: 50%;
    animation-delay: -15s;
}

@keyframes float {
    0%, 100% {
        transform: translate(0, 0) scale(1);
    }
    25% {
        transform: translate(30px, -50px) scale(1.05);
    }
    50% {
        transform: translate(-20px, 30px) scale(0.95);
    }
    75% {
        transform: translate(50px, 20px) scale(1.02);
    }
}

/* ===================================
   BASE LAYOUT
   =================================== */
.container {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 24px;
    position: relative;
    z-index: 1;
}

a {
    text-decoration: none;
    color: var(--text-primary);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

a:hover {
    color: var(--primary-light);
}

/* ===================================
   TYPOGRAPHY
   =================================== */
h1, h2, h3, h4, h5, h6 {
    font-weight: 700;
    line-height: 1.2;
    margin-bottom: 0.5em;
}

h1 {
    font-size: clamp(2.5rem, 5vw, 4rem);
    letter-spacing: -0.02em;
}

h2 {
    font-size: clamp(2rem, 4vw, 3rem);
    text-align: center;
    margin-bottom: 1rem;
}

h3 {
    font-size: 1.5rem;
    font-weight: 600;
}

.gradient-text {
    background: var(--gradient-primary);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.section-subtitle {
    text-align: center;
    color: var(--text-secondary);
    font-size: 1.1rem;
    max-width: 600px;
    margin: 0 auto 3rem;
}

/* ===================================
   NAVIGATION
   =================================== */
header {
    position: relative;
    overflow: hidden;
}

nav {
    padding: 20px 0;
    position: relative;
    z-index: 100;
    background: rgba(13, 17, 23, 0.8);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--glass-border);
}

.nav-container {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.logo {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 12px;
}

.logo:hover {
    color: var(--text-primary);
}

.logo-img {
    height: 36px;
    width: auto;
    border-radius: 50%;
    box-shadow: 0 0 20px var(--glow-color);
    transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.logo:hover .logo-img {
    transform: scale(1.1);
    box-shadow: 0 0 30px var(--glow-color);
}

.nav-links {
    display: flex;
    gap: 32px;
    align-items: center;
}

.nav-links a {
    font-weight: 500;
    font-size: 0.95rem;
    color: var(--text-secondary);
    position: relative;
    padding: 8px 0;
}

.nav-links a::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    width: 0;
    height: 2px;
    background: var(--gradient-primary);
    transition: width 0.3s ease;
}

.nav-links a:hover {
    color: var(--text-primary);
}

.nav-links a:hover::after {
    width: 100%;
}

.github-link {
    font-size: 1.3rem;
    color: var(--text-secondary);
}

.github-link:hover {
    color: var(--text-primary);
    transform: scale(1.1);
}

.invite-btn {
    background: var(--gradient-hero);
    color: var(--text-primary) !important;
    padding: 10px 24px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.95rem;
    box-shadow: 0 4px 20px var(--glow-color);
    transition: all 0.3s ease;
}

.invite-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px var(--glow-color);
}

/* ===================================
   HERO SECTION
   =================================== */
.hero-section {
    padding: 120px 0 140px;
    position: relative;
    min-height: 80vh;
    display: flex;
    align-items: center;
}

.hero-desktop {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 60px;
}

.hero-mobile {
    display: none;
}

.hero-content {
    flex: 1;
    max-width: 55%;
}

.hero-content h1 {
    margin-bottom: 1.5rem;
}

.subtitle {
    font-size: 1.25rem;
    margin-bottom: 2.5rem;
    color: var(--text-secondary);
    line-height: 1.7;
}

.cta-buttons {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
}

.primary-btn {
    background: var(--gradient-hero);
    color: var(--text-primary);
    padding: 16px 32px;
    border-radius: 12px;
    font-weight: 600;
    font-size: 1rem;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    box-shadow: 0 4px 24px var(--glow-color);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    border: none;
    cursor: pointer;
}

.primary-btn:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 40px var(--glow-color);
    color: var(--text-primary);
}

.primary-btn:active {
    transform: translateY(-1px);
}

.secondary-btn {
    background: transparent;
    border: 2px solid var(--glass-border);
    color: var(--text-primary);
    padding: 14px 32px;
    border-radius: 12px;
    font-weight: 600;
    font-size: 1rem;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    backdrop-filter: blur(10px);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.secondary-btn:hover {
    border-color: var(--primary-color);
    background: rgba(88, 101, 242, 0.1);
    transform: translateY(-3px);
    color: var(--text-primary);
}

.hero-image {
    flex: 1;
    max-width: 45%;
    position: relative;
}

.hero-image img {
    width: 100%;
    height: auto;
    border-radius: 16px;
    box-shadow: 0 20px 60px var(--shadow-color),
                0 0 40px var(--glow-color);
    border: 1px solid var(--glass-border);
}

/* ===================================
   GLASSMORPHISM CARDS
   =================================== */
.glass-card {
    background: var(--bg-card);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    padding: 32px;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.glass-card:hover {
    transform: translateY(-8px);
    border-color: rgba(88, 101, 242, 0.3);
    box-shadow: 0 20px 40px var(--shadow-color),
                0 0 30px rgba(88, 101, 242, 0.15);
}

/* ===================================
   FEATURES SECTION
   =================================== */
.features-section {
    padding: 120px 0;
    position: relative;
}

.features-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 24px;
    margin-top: 60px;
}

.feature-card {
    background: var(--bg-card);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    padding: 32px;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
}

.feature-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--gradient-primary);
    opacity: 0;
    transition: opacity 0.3s ease;
}

.feature-card:hover {
    transform: translateY(-8px);
    border-color: rgba(88, 101, 242, 0.3);
    box-shadow: 0 20px 40px var(--shadow-color),
                0 0 30px rgba(88, 101, 242, 0.15);
}

.feature-card:hover::before {
    opacity: 1;
}

.feature-icon {
    width: 56px;
    height: 56px;
    background: var(--gradient-card);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    color: var(--primary-light);
    margin-bottom: 20px;
    transition: all 0.3s ease;
}

.feature-card:hover .feature-icon {
    transform: scale(1.1);
    box-shadow: 0 0 30px var(--glow-color);
}

.feature-card h3 {
    margin-bottom: 12px;
    color: var(--text-primary);
}

.feature-card p {
    color: var(--text-secondary);
    line-height: 1.7;
}

/* ===================================
   HOW IT WORKS SECTION
   =================================== */
.how-it-works-section {
    padding: 120px 0;
    background: var(--bg-secondary);
    position: relative;
}

.steps-container {
    display: flex;
    flex-direction: column;
    gap: 32px;
    margin-top: 60px;
    max-width: 800px;
    margin-left: auto;
    margin-right: auto;
}

.step {
    display: flex;
    align-items: flex-start;
    gap: 24px;
    background: var(--bg-card);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    padding: 32px;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.step:hover {
    transform: translateX(10px);
    border-color: rgba(88, 101, 242, 0.3);
    box-shadow: 0 10px 40px var(--shadow-color);
}

.step-number {
    background: var(--gradient-hero);
    width: 56px;
    height: 56px;
    min-width: 56px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    font-weight: 700;
    box-shadow: 0 4px 20px var(--glow-color);
}

.step-content h3 {
    margin-bottom: 8px;
}

.step-content p {
    color: var(--text-secondary);
}

.step-content code {
    background: rgba(88, 101, 242, 0.2);
    color: var(--primary-light);
    padding: 4px 10px;
    border-radius: 6px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.9rem;
}

/* ===================================
   PLATFORMS SECTION
   =================================== */
.platforms-section {
    padding: 120px 0;
    position: relative;
}

.platforms-grid {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 24px;
    margin-top: 60px;
}

.platform-card {
    background: var(--bg-card);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    padding: 32px;
    text-align: center;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
    flex: 1 1 220px;
    max-width: 320px;
}

.platform-card:hover {
    transform: translateY(-8px) scale(1.02);
    border-color: rgba(88, 101, 242, 0.3);
    box-shadow: 0 20px 40px var(--shadow-color),
                0 0 30px rgba(88, 101, 242, 0.15);
}

.platform-icon {
    width: 72px;
    height: 72px;
    background: var(--gradient-card);
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    color: var(--primary-light);
    margin: 0 auto 20px;
    transition: all 0.4s ease;
}

.platform-card:hover .platform-icon {
    transform: scale(1.15) rotate(5deg);
    box-shadow: 0 0 40px var(--glow-color);
}

.platform-card h3 {
    margin-bottom: 8px;
    font-size: 1.25rem;
}

.platform-card p {
    color: var(--text-secondary);
    font-size: 0.95rem;
}

/* ===================================
   CTA SECTION
   =================================== */
.cta-section {
    padding: 120px 0;
    background: var(--gradient-hero);
    position: relative;
    overflow: hidden;
}

.cta-section::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
    pointer-events: none;
}

.cta-content {
    max-width: 700px;
    margin: 0 auto;
    text-align: center;
    position: relative;
    z-index: 1;
}

.cta-content h2 {
    margin-bottom: 1rem;
    color: #fff;
}

.cta-content p {
    margin-bottom: 2rem;
    font-size: 1.2rem;
    color: rgba(255, 255, 255, 0.9);
}

.cta-section .primary-btn {
    background: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(10px);
    border: 2px solid rgba(255, 255, 255, 0.3);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
}

.cta-section .primary-btn:hover {
    background: rgba(255, 255, 255, 0.25);
    border-color: rgba(255, 255, 255, 0.5);
}

/* ===================================
   HOSTING SECTION
   =================================== */
.hosting-section {
    padding: 120px 0;
    background: var(--bg-secondary);
}

.hosting-content {
    display: flex;
    justify-content: center;
}

.hosting-text {
    max-width: 800px;
    background: var(--bg-card);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    padding: 40px;
}

.code-block {
    background: var(--bg-primary);
    padding: 24px;
    border-radius: 12px;
    margin: 24px 0;
    overflow-x: auto;
    border: 1px solid var(--glass-border);
}

.code-block pre {
    margin: 0;
}

code {
    font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
    color: var(--accent-cyan);
    font-size: 0.95rem;
}

.note {
    margin-top: 20px;
    font-style: italic;
    color: var(--text-secondary);
    padding: 16px;
    background: rgba(88, 101, 242, 0.1);
    border-radius: 8px;
    border-left: 3px solid var(--primary-color);
}

/* ===================================
   SUPPORT SECTION
   =================================== */
.support-section {
    padding: 120px 0;
    position: relative;
}

.support-options {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 24px;
    margin-top: 60px;
}

.support-card {
    background: var(--bg-card);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    padding: 32px;
    text-align: center;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.support-card:hover {
    transform: translateY(-8px);
    border-color: rgba(88, 101, 242, 0.3);
    box-shadow: 0 20px 40px var(--shadow-color),
                0 0 30px rgba(88, 101, 242, 0.15);
}

.support-icon {
    width: 72px;
    height: 72px;
    background: var(--gradient-card);
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    color: var(--primary-light);
    margin: 0 auto 20px;
    transition: all 0.4s ease;
}

.support-card:hover .support-icon {
    transform: scale(1.1);
    box-shadow: 0 0 30px var(--glow-color);
}

.support-link {
    display: inline-block;
    margin-top: 16px;
    padding: 10px 24px;
    background: var(--gradient-hero);
    color: var(--text-primary);
    border-radius: 8px;
    font-weight: 600;
}

.support-link:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 20px var(--glow-color);
    color: var(--text-primary);
}

/* ===================================
   CREDITS SECTION
   =================================== */
.credits-section {
    padding: 80px 0;
    border-top: 1px solid var(--glass-border);
}

.credits-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    justify-content: center;
    margin-top: 40px;
}

.credit-link {
    background: var(--bg-secondary);
    padding: 12px 20px;
    border-radius: 8px;
    border: 1px solid var(--glass-border);
    color: var(--text-secondary);
    font-size: 0.9rem;
    transition: all 0.3s ease;
}

.credit-link:hover {
    border-color: var(--primary-color);
    color: var(--primary-light);
    background: rgba(88, 101, 242, 0.05);
}

/* ===================================
   FOOTER
   =================================== */
footer {
    background: var(--bg-secondary);
    padding: 80px 0 40px;
    border-top: 1px solid var(--glass-border);
}

.footer-content {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 40px;
}

.footer-logo {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 16px;
    display: inline-block;
    background: linear-gradient(135deg, #7c3aed, #ec4899);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.footer-left p {
    color: var(--text-secondary);
    max-width: 300px;
}

.footer-links {
    display: flex;
    gap: 24px;
    margin-bottom: 16px;
}

.footer-links a {
    color: var(--text-secondary);
}

.footer-links a:hover {
    color: var(--primary-light);
}

.copyright {
    color: var(--text-muted);
    font-size: 0.9rem;
}

/* ===================================
   MEDIA QUERIES
   =================================== */
@media (max-width: 992px) {
    .hero-desktop {
        flex-direction: column-reverse;
        text-align: center;
    }

    .hero-content {
        max-width: 100%;
    }

    .hero-image {
        max-width: 80%;
    }

    .cta-buttons {
        justify-content: center;
    }
}

@media (max-width: 768px) {
    /* Hide desktop hero, show mobile optimized */
    .hero-desktop {
        display: none;
    }

    .hero-mobile {
        display: block;
        text-align: center;
        padding-top: 40px;
    }

    .hero-mobile h1 {
        font-size: 2.5rem;
        margin-bottom: 20px;
    }

    .subtitle {
        font-size: 1.1rem;
    }

    .mobile-buttons {
        display: flex;
        flex-direction: column;
        gap: 16px;
        margin-bottom: 40px;
    }

    .primary-btn, .secondary-btn {
        width: 100%;
        justify-content: center;
    }

    .hero-image-mobile img {
        width: 100%;
        border-radius: 12px;
        box-shadow: 0 10px 40px var(--shadow-color);
        border: 1px solid var(--glass-border);
    }
    
    .nav-links {
        display: none; /* Can be replaced with hamburger menu later */
    }

    .hero-section {
        padding: 40px 0 80px;
    }

    h1 {
        font-size: 2.2rem;
    }

    h2 {
        font-size: 1.8rem;
    }

    .features-grid {
        grid-template-columns: 1fr;
    }

    .platforms-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}

@media (max-width: 480px) {
    .platforms-grid {
        grid-template-columns: 1fr;
    }

    .hosting-text {
        padding: 24px;
    }
}`;

export const scriptJs = `document.addEventListener('DOMContentLoaded', function () {
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
        element.style.transition = \`opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1) \${index % 6 * 0.1}s, 
                                    transform 0.6s cubic-bezier(0.4, 0, 0.2, 1) \${index % 6 * 0.1}s\`;
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
                heroImage.style.transform = \`translateY(\${rate}px)\`;
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
            shape.style.transform = \`translate(\${currentX * factor}px, \${currentY * factor}px)\`;
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

            ripple.style.cssText = \`
                position: absolute;
                background: rgba(255, 255, 255, 0.3);
                border-radius: 50%;
                pointer-events: none;
                transform: scale(0);
                animation: ripple 0.6s ease-out;
            \`;

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
    style.textContent = \`
        @keyframes ripple {
            to {
                transform: scale(4);
                opacity: 0;
            }
        }
    \`;
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
        additionalStyle.textContent = \`
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
        \`;
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
});`;

export const tosHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Terms of Service - FixEmbed</title>
    <meta name="description" content="Terms of Service for FixEmbed">
    <meta name="theme-color" content="#7c3aed">
    <link rel="icon" href="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/logo.png" type="image/png">
    <meta name="color-scheme" content="dark">
    <style>
        html, body { background-color: #0d1117; }
        body { opacity: 0; transition: opacity 0.1s ease-in; }
        body.loaded { opacity: 1; }
    </style>
    <link rel="stylesheet" href="/styles.css" onload="document.body.classList.add('loaded')">
    <noscript><style>body { opacity: 1; }</style></noscript>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
    <div class="floating-shapes">
        <div class="shape shape-1"></div>
        <div class="shape shape-2"></div>
        <div class="shape shape-3"></div>
        <div class="shape shape-4"></div>
    </div>

    <header>
        <nav>
            <div class="container">
                <div class="nav-container">
                    <a href="/" class="logo">
                        <img src="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/logo.png" alt="FixEmbed Logo" class="logo-img">
                        <span>FixEmbed</span>
                    </a>
                    <div class="nav-links">
                        <a href="/#features">Features</a>
                        <a href="/docs">Docs</a>
                        <a href="/#platforms">Platforms</a>
                        <a href="/support">Support</a>
                        <a href="https://github.com/kenhendricks00/FixEmbed" class="github-link" target="_blank">
                            <i class="fab fa-github"></i>
                        </a>
                    </div>
                    <a href="https://discord.com/oauth2/authorize?client_id=1173820242305224764" class="invite-btn" target="_blank">Invite Bot</a>
                </div>
            </div>
        </nav>
    </header>

    <section class="features-section" style="padding-top: 100px; min-height: 80vh;">
        <div class="container">
            <div class="glass-card">
                <h1>Terms of Service</h1>
                <p class="subtitle" style="text-align: left; margin-bottom: 2rem;">Last updated: December 24, 2024</p>
                
                <div class="content" style="color: var(--text-secondary); line-height: 1.8;">
                    <h3 style="color: var(--text-primary); margin-top: 2rem;">1. Acceptance of Terms</h3>
                    <p>By accessing and using FixEmbed ("the Service"), you accept and agree to be bound by the terms and provision of this agreement.</p>

                    <h3 style="color: var(--text-primary); margin-top: 2rem;">2. Description of Service</h3>
                    <p>FixEmbed is a utility service that generates link previews (embeds) for various social media platforms on Discord. The Service acts as a proxy to format publicly available metadata.</p>

                    <h3 style="color: var(--text-primary); margin-top: 2rem;">3. User Conduct</h3>
                    <p>You agree not to use the Service to:</p>
                    <ul style="list-style-position: inside; margin-left: 1rem;">
                        <li>Violate any applicable laws or regulations</li>
                        <li>Infringe upon the rights of others</li>
                        <li>Interfere with or disrupt the Service operation</li>
                        <li>Send automated queries that excessively burden the service or third-party platforms</li>
                    </ul>

                    <h3 style="color: var(--text-primary); margin-top: 2rem;">4. Disclaimer</h3>
                    <p>The Service is provided "as is" without warranties of any kind, either express or implied. We are not responsible for the content generated in previews, which originates from third-party platforms.</p>

                    <h3 style="color: var(--text-primary); margin-top: 2rem;">5. Third-Party Services</h3>
                    <p>FixEmbed interacts with third-party platforms (Twitter/X, Instagram, Reddit, Threads, Pixiv, Bluesky, Bilibili). We are not affiliated with these platforms. Availability of the Service relies on these platforms' uptime and API access.</p>

                    <h3 style="color: var(--text-primary); margin-top: 2rem;">6. Modifications to Terms</h3>
                    <p>We reserve the right to modify these terms at any time. Continued use of the Service after changes constitutes acceptance of the new terms.</p>

                    <h3 style="color: var(--text-primary); margin-top: 2rem;">7. Termination</h3>
                    <p>We may terminate or suspend access to the Service immediately, without prior notice, for conduct that we believe violates these Terms or is harmful to other users or the Service.</p>
                </div>
            </div>
        </div>
    </section>

    <footer>
        <div class="container">
            <div class="footer-content">
                <div class="footer-left">
                    <span class="footer-logo">FixEmbed</span>
                    <p>A Discord bot that fixes the lack of embed support in Discord.</p>
                </div>
                <div class="footer-right">
                    <div class="footer-links">
                        <a href="/docs">Docs</a>
                        <a href="/tos">Terms</a>
                        <a href="/privacy">Privacy</a>
                        <a href="https://github.com/kenhendricks00/FixEmbed">GitHub</a>
                    </div>
                    <p class="copyright">© 2023-2025 FixEmbed</p>
                </div>
            </div>
        </div>
    </footer>
    <script src="/script.js"></script>
</body>
</html>`;

export const privacyHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy - FixEmbed</title>
    <meta name="description" content="Privacy Policy for FixEmbed">
    <meta name="theme-color" content="#7c3aed">
    <link rel="icon" href="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/logo.png" type="image/png">
    <meta name="color-scheme" content="dark">
    <style>
        html, body { background-color: #0d1117; }
        body { opacity: 0; transition: opacity 0.1s ease-in; }
        body.loaded { opacity: 1; }
    </style>
    <link rel="stylesheet" href="/styles.css" onload="document.body.classList.add('loaded')">
    <noscript><style>body { opacity: 1; }</style></noscript>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
    <div class="floating-shapes">
        <div class="shape shape-1"></div>
        <div class="shape shape-2"></div>
        <div class="shape shape-3"></div>
        <div class="shape shape-4"></div>
    </div>

    <header>
        <nav>
            <div class="container">
                <div class="nav-container">
                    <a href="/" class="logo">
                        <img src="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/logo.png" alt="FixEmbed Logo" class="logo-img">
                        <span>FixEmbed</span>
                    </a>
                    <div class="nav-links">
                        <a href="/#features">Features</a>
                        <a href="/docs">Docs</a>
                        <a href="/#platforms">Platforms</a>
                        <a href="/support">Support</a>
                        <a href="https://github.com/kenhendricks00/FixEmbed" class="github-link" target="_blank">
                            <i class="fab fa-github"></i>
                        </a>
                    </div>
                    <a href="https://discord.com/oauth2/authorize?client_id=1173820242305224764" class="invite-btn" target="_blank">Invite Bot</a>
                </div>
            </div>
        </nav>
    </header>

    <section class="features-section" style="padding-top: 100px; min-height: 80vh;">
        <div class="container">
            <div class="glass-card">
                <h1>Privacy Policy</h1>
                <p class="subtitle" style="text-align: left; margin-bottom: 2rem;">Last updated: December 24, 2024</p>
                
                <div class="content" style="color: var(--text-secondary); line-height: 1.8;">
                    <h3 style="color: var(--text-primary); margin-top: 2rem;">1. Data Collection</h3>
                    <p>FixEmbed is designed to be privacy-focused. We do not persist or store personal user data.</p>
                    <ul style="list-style-position: inside; margin-left: 1rem;">
                        <li><strong>Ephemeral Processing:</strong> URLs sent to our service are processed in-memory to generate embeds and are not permanently stored.</li>
                        <li><strong>Logs:</strong> Cloudflare may keep temporary technical logs for debugging and abuse prevention. These logs are rotated regularly.</li>
                    </ul>

                    <h3 style="color: var(--text-primary); margin-top: 2rem;">2. Cookies and Tracking</h3>
                    <p>We do not use tracking cookies or third-party analytics on our service.</p>

                    <h3 style="color: var(--text-primary); margin-top: 2rem;">3. Data Sharing</h3>
                    <p>We do not sell, trade, or transfer your information to outside parties. When you use FixEmbed, we make requests to public social media pages on your behalf to fetch metadata.</p>

                    <h3 style="color: var(--text-primary); margin-top: 2rem;">4. Third-Party Links</h3>
                    <p>Our service generates links to third-party content. We are not responsible for the privacy practices of those external sites.</p>

                    <h3 style="color: var(--text-primary); margin-top: 2rem;">5. Children's Privacy</h3>
                    <p>Our Service is not directed to children under 13. We do not knowingly collect personal information from children.</p>

                    <h3 style="color: var(--text-primary); margin-top: 2rem;">6. Contact</h3>
                    <p>If you have questions about this privacy policy, reach out on our <a href="https://discord.gg/QFxTAmtZdn" style="color: var(--primary-light);">Discord Support Server</a>.</p>
                </div>
            </div>
        </div>
    </section>

    <footer>
        <div class="container">
            <div class="footer-content">
                <div class="footer-left">
                    <span class="footer-logo">FixEmbed</span>
                    <p>A Discord bot that fixes the lack of embed support in Discord.</p>
                </div>
                <div class="footer-right">
                    <div class="footer-links">
                        <a href="/docs">Docs</a>
                        <a href="/tos">Terms</a>
                        <a href="/privacy">Privacy</a>
                        <a href="https://github.com/kenhendricks00/FixEmbed">GitHub</a>
                    </div>
                    <p class="copyright">© 2023-2025 FixEmbed</p>
                </div>
            </div>
        </div>
    </footer>
    <script src="/script.js"></script>
</body>
</html>`;

export const docsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Documentation - FixEmbed</title>
    <meta name="description" content="Documentation for FixEmbed - Learn how to use the bot and API">
    <meta name="theme-color" content="#7c3aed">
    <link rel="icon" href="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/logo.png" type="image/png">
    <meta name="color-scheme" content="dark">
    <style>
        html, body { background-color: #0d1117; }
        body { opacity: 0; transition: opacity 0.1s ease-in; }
        body.loaded { opacity: 1; }
    </style>
    <link rel="stylesheet" href="/styles.css" onload="document.body.classList.add('loaded')">
    <noscript><style>body { opacity: 1; }</style></noscript>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        .docs-nav { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; justify-content: center; }
        .docs-nav a { padding: 0.75rem 1.5rem; background: var(--bg-tertiary); border-radius: 8px; color: var(--text-secondary); border: 1px solid var(--glass-border); }
        .docs-nav a:hover { background: var(--primary-color); color: white; border-color: var(--primary-color); }
        .code-example { background: var(--bg-primary); padding: 1rem 1.5rem; border-radius: 8px; border: 1px solid var(--glass-border); overflow-x: auto; margin: 1rem 0; }
        .code-example code { color: var(--accent-cyan); font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.9rem; }
        .docs-section { margin-top: 3rem; }
        .docs-section:first-child { margin-top: 0; }
        .endpoint-table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
        .endpoint-table th, .endpoint-table td { padding: 0.75rem; text-align: left; border-bottom: 1px solid var(--glass-border); }
        .endpoint-table th { color: var(--text-primary); background: var(--bg-tertiary); }
        .method-badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
        .method-get { background: rgba(87, 242, 135, 0.2); color: #57F287; }
    </style>
</head>
<body>
    <div class="floating-shapes">
        <div class="shape shape-1"></div>
        <div class="shape shape-2"></div>
        <div class="shape shape-3"></div>
        <div class="shape shape-4"></div>
    </div>

    <header>
        <nav>
            <div class="container">
                <div class="nav-container">
                    <a href="/" class="logo">
                        <img src="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/logo.png" alt="FixEmbed Logo" class="logo-img">
                        <span>FixEmbed</span>
                    </a>
                    <div class="nav-links">
                        <a href="/#features">Features</a>
                        <a href="/docs">Docs</a>
                        <a href="/#platforms">Platforms</a>
                        <a href="/support">Support</a>
                        <a href="https://github.com/kenhendricks00/FixEmbed" class="github-link" target="_blank">
                            <i class="fab fa-github"></i>
                        </a>
                    </div>
                    <a href="https://discord.com/oauth2/authorize?client_id=1173820242305224764" class="invite-btn" target="_blank">Invite Bot</a>
                </div>
            </div>
        </nav>
    </header>

    <section class="features-section" style="padding-top: 100px; min-height: 80vh;">
        <div class="container">
            <h1 style="margin-bottom: 0.5rem; text-align: center;">Documentation</h1>
            <p class="section-subtitle" style="text-align: center; margin-bottom: 2rem;">Everything you need to use FixEmbed</p>

            <div class="docs-nav">
                <a href="#bot-usage">🤖 Bot Usage</a>
                <a href="#api-usage">⚡ API Usage</a>
                <a href="#supported-platforms">🌐 Platforms</a>
            </div>

            <div class="glass-card">
                <div id="bot-usage" class="docs-section">
                    <h2><span class="gradient-text">Bot Usage</span></h2>
                    <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">FixEmbed works automatically in servers and can be used anywhere via commands.</p>

                    <h3 style="margin-top: 1.5rem;">Automatic Conversion (Server Mode)</h3>
                    <p style="color: var(--text-secondary);">When FixEmbed is added to a server, it automatically detects supported social media links and converts them to rich embeds. No commands needed!</p>

                    <h3 style="margin-top: 1.5rem;">Slash Commands</h3>
                    <div class="code-example">
                        <code>/fix &lt;url&gt;</code>
                    </div>
                    <p style="color: var(--text-secondary);">Use this command anywhere—even in servers without FixEmbed installed (if you have the bot installed to your account).</p>

                    <h3 style="margin-top: 1.5rem;">Context Menu</h3>
                    <p style="color: var(--text-secondary);">Right-click any message → <strong>Apps</strong> → <strong>Fix Embed</strong> to convert links in that message.</p>

                    <h3 style="margin-top: 1.5rem;">Settings</h3>
                    <div class="code-example">
                        <code>/settings</code>
                    </div>
                    <p style="color: var(--text-secondary);">Configure which platforms are enabled/disabled, per-channel settings, and more.</p>
                </div>

                <div id="api-usage" class="docs-section">
                    <h2><span class="gradient-text">API Usage</span></h2>
                    <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">Use the FixEmbed API directly to generate embeds programmatically.</p>

                    <h3 style="margin-top: 1.5rem;">Endpoints</h3>
                    <table class="endpoint-table">
                        <thead>
                            <tr>
                                <th>Method</th>
                                <th>Endpoint</th>
                                <th>Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><span class="method-badge method-get">GET</span></td>
                                <td><code>/embed?url=...</code></td>
                                <td>Generate embed HTML for a URL</td>
                            </tr>
                            <tr>
                                <td><span class="method-badge method-get">GET</span></td>
                                <td><code>/oembed?url=...</code></td>
                                <td>oEmbed JSON metadata</td>
                            </tr>
                        </tbody>
                    </table>

                    <h3 style="margin-top: 1.5rem;">Example Request</h3>
                    <div class="code-example">
                        <code>GET https://fixembed.app/embed?url=https://twitter.com/user/status/123</code>
                    </div>

                    <h3 style="margin-top: 1.5rem;">Response</h3>
                    <p style="color: var(--text-secondary);">Returns HTML with proper Open Graph and Twitter Card meta tags for rich previews. Browsers/bots receive embed-ready HTML; regular users are redirected to the original URL.</p>
                </div>

                <div id="supported-platforms" class="docs-section">
                    <h2><span class="gradient-text">Supported Platforms</span></h2>
                    <table class="endpoint-table">
                        <thead>
                            <tr>
                                <th>Platform</th>
                                <th>Domains</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr><td>Twitter / X</td><td>twitter.com, x.com</td></tr>
                            <tr><td>Instagram</td><td>instagram.com</td></tr>
                            <tr><td>Reddit</td><td>reddit.com, redd.it</td></tr>
                            <tr><td>Threads</td><td>threads.net</td></tr>
                            <tr><td>Pixiv</td><td>pixiv.net</td></tr>
                            <tr><td>Bluesky</td><td>bsky.app</td></tr>

                            <tr><td>Bilibili</td><td>bilibili.com, b23.tv</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </section>

    <footer>
        <div class="container">
            <div class="footer-content">
                <div class="footer-left">
                    <span class="footer-logo">FixEmbed</span>
                    <p>A Discord bot that fixes the lack of embed support in Discord.</p>
                </div>
                <div class="footer-right">
                    <div class="footer-links">
                        <a href="/docs">Docs</a>
                        <a href="/tos">Terms</a>
                        <a href="/privacy">Privacy</a>
                        <a href="https://github.com/kenhendricks00/FixEmbed">GitHub</a>
                    </div>
                    <p class="copyright">© 2023-2025 FixEmbed</p>
                </div>
            </div>
        </div>
    </footer>
    <script src="/script.js"></script>
</body>
</html>`;

export const supportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Support FixEmbed</title>
    <meta name="description" content="Support FixEmbed - Vote, donate, or contribute to the project">
    <meta name="theme-color" content="#7c3aed">
    <link rel="icon" href="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/logo.png" type="image/png">
    <meta name="color-scheme" content="dark">
    <style>
        html, body { background-color: #0d1117; }
        body { opacity: 0; transition: opacity 0.1s ease-in; }
        body.loaded { opacity: 1; }
        .support-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 2rem;
            margin-top: 2rem;
        }
        .support-card {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 2rem;
            text-align: center;
            transition: all 0.3s ease;
        }
        .support-card:hover {
            transform: translateY(-5px);
            border-color: var(--primary);
            box-shadow: 0 10px 40px rgba(124, 58, 237, 0.2);
        }
        .support-card i {
            font-size: 3rem;
            margin-bottom: 1rem;
        }
        .support-card h3 {
            color: var(--text-primary);
            margin-bottom: 0.5rem;
        }
        .support-card p {
            color: var(--text-secondary);
            margin-bottom: 1.5rem;
        }
        .support-card .btn {
            display: inline-block;
            padding: 0.75rem 2rem;
            border-radius: 8px;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.3s ease;
        }
        .btn-topgg { background: linear-gradient(135deg, #ff3366, #ff6b9d); color: white; }
        .btn-discord { background: #5865F2; color: white; }
        .btn-github { background: #333; color: white; }
        .btn:hover { transform: scale(1.05); box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3); }
        .topgg-icon { color: #ff3366; }
        .discord-icon { color: #5865F2; }
        .github-icon { color: #f0f0f0; }
    </style>
    <link rel="stylesheet" href="/styles.css" onload="document.body.classList.add('loaded')">
    <noscript><style>body { opacity: 1; }</style></noscript>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
    <div class="floating-shapes">
        <div class="shape shape-1"></div>
        <div class="shape shape-2"></div>
        <div class="shape shape-3"></div>
        <div class="shape shape-4"></div>
    </div>
    <header>
        <nav>
            <div class="container">
                <div class="nav-container">
                    <a href="/" class="logo">
                        <img src="https://raw.githubusercontent.com/kenhendricks00/FixEmbed/refs/heads/main/assets/logo.png" alt="FixEmbed Logo" class="logo-img">
                        <span>FixEmbed</span>
                    </a>
                    <div class="nav-links">
                        <a href="/#features">Features</a>
                        <a href="/docs">Docs</a>
                        <a href="/#platforms">Platforms</a>
                        <a href="/support">Support</a>
                        <a href="https://github.com/kenhendricks00/FixEmbed" class="github-link" target="_blank">
                            <i class="fab fa-github"></i>
                        </a>
                    </div>
                    <a href="https://discord.com/oauth2/authorize?client_id=1173820242305224764" class="invite-btn" target="_blank">Invite Bot</a>
                </div>
            </div>
        </nav>
    </header>
    <section class="features-section" style="padding-top: 100px; min-height: 80vh;">
        <div class="container">
            <div style="text-align: center; margin-bottom: 3rem;">
                <h1 style="margin-bottom: 0.5rem;">Support FixEmbed</h1>
                <p class="section-subtitle">Help us keep FixEmbed running and improving!</p>
            </div>
            <div class="support-grid">
                <div class="support-card">
                    <i class="fas fa-heart" style="color: #ff5e5b;"></i>
                    <h3>Donate on Ko-fi</h3>
                    <p>Help cover server costs and support development!</p>
                    <a href="https://ko-fi.com/kenhendricks" target="_blank" class="btn" style="background: linear-gradient(135deg, #ff5e5b, #ff9966); color: white;">
                        <i class="fas fa-mug-hot"></i> Ko-fi
                    </a>
                </div>
                <div class="support-card">
                    <i class="fas fa-coffee" style="color: #FFDD00;"></i>
                    <h3>Buy Me a Coffee</h3>
                    <p>Another way to support FixEmbed development!</p>
                    <a href="https://buymeacoffee.com/kenhendricks" target="_blank" class="btn" style="background: #FFDD00; color: #000;">
                        <i class="fas fa-coffee"></i> Buy a Coffee
                    </a>
                </div>
                <div class="support-card">
                    <i class="fas fa-star topgg-icon"></i>
                    <h3>Vote on Top.gg</h3>
                    <p>Voting helps us reach more users. Free and takes seconds!</p>
                    <a href="https://top.gg/bot/1173820242305224764" target="_blank" class="btn btn-topgg">
                        <i class="fas fa-arrow-up"></i> Vote Now
                    </a>
                </div>
                <div class="support-card">
                    <i class="fab fa-discord discord-icon"></i>
                    <h3>Join Discord</h3>
                    <p>Get help, report issues, and hang out with the community!</p>
                    <a href="https://discord.gg/QFxTAmtZdn" target="_blank" class="btn btn-discord">
                        <i class="fab fa-discord"></i> Join Server
                    </a>
                </div>
                <div class="support-card">
                    <i class="fab fa-github github-icon"></i>
                    <h3>Contribute</h3>
                    <p>Star the repo, report bugs, or submit pull requests!</p>
                    <a href="https://github.com/kenhendricks00/FixEmbed" target="_blank" class="btn btn-github">
                        <i class="fab fa-github"></i> View on GitHub
                    </a>
                </div>
            </div>
        </div>
    </section>
    <footer>
        <div class="container">
            <div class="footer-content">
                <div class="footer-left">
                    <span class="footer-logo">FixEmbed</span>
                    <p>A Discord bot that fixes the lack of embed support in Discord.</p>
                </div>
                <div class="footer-right">
                    <div class="footer-links">
                        <a href="/docs">Docs</a>
                        <a href="/tos">Terms</a>
                        <a href="/privacy">Privacy</a>
                        <a href="https://github.com/kenhendricks00/FixEmbed">GitHub</a>
                    </div>
                    <p class="copyright">© 2023-2025 FixEmbed</p>
                </div>
            </div>
        </div>
    </footer>
    <script src="/script.js"></script>
</body>
</html>`;
