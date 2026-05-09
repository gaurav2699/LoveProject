/* =========================================================
 *  Apology Game — "Catch My Sorry, Puchi"
 *
 *  A self-contained heart-catching mini-game. Loaded after
 *  the existing scripts, attaches itself only to the new
 *  #apology-game-* nodes added in index.html. It does not
 *  modify, replace, or remove any existing behavior.
 *
 *  Flow:
 *    1. Player clicks the floating "A Little Game for You"
 *       button. The overlay opens with an intro card.
 *    2. Pressing "Play" begins level 1. Hearts, roses,
 *       chocolates, diamonds and rain clouds fall from the
 *       top of the canvas. The player moves a basket with
 *       the mouse, touch, or arrow keys.
 *    3. Catching items fills the apology meter and shows
 *       a sweet message banner. Rain clouds reduce score.
 *    4. The game advances through three levels (faster,
 *       more variety). At 100% the finale card appears
 *       with a personalized apology letter and a confetti
 *       burst.
 * ========================================================= */
(function () {
	'use strict';

	// ---- Apology messages shown when items are caught ----
	const APOLOGY_LINES = [
		"I'm so sorry, Puchiya 💔",
		"You deserve all the love in the world ✨",
		"I promise to listen better, my heart 🥺",
		"Every fight ends, but my love for you doesn't 💞",
		"Forgive me? I'll bring chocolates 🍫",
		"You make my world brighter every single day ☀️",
		"I'm a fool — but I'm YOUR fool 🤡❤️",
		"Your smile is my happy place 😊",
		"Please don't stay mad at me 🥺",
		"Even my mistakes lead me back to you 💕",
		"I'll dance silly to make you laugh again 🕺",
		"You're my home, my heart, my everything 🏠",
		"I love you more than yesterday, less than tomorrow 📈",
		"Sorry, sorry, sorry — a thousand times over 💌",
		"My favourite person, please forgive me 💖",
		"Your hugs heal everything 🤗",
		"I'd catch a million hearts to fix this 💘",
		"You + Me = always, no matter what ♾️",
		"You're the reason I smile in my sleep 😴💕",
		"Hani Gaurav — forever and ever 💍"
	];

	// Emoji-aware font stack. iOS Safari does not always fall back
	// to the system color-emoji font when the canvas font is just
	// "serif", so we name the platform emoji families explicitly.
	const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", serif';

	// ---- Item type catalogue ----
	const ITEM_TYPES = [
		{ glyph: '💖', points: 5,  weight: 50, isBad: false },
		{ glyph: '🌹', points: 8,  weight: 22, isBad: false },
		{ glyph: '🍫', points: 10, weight: 14, isBad: false },
		{ glyph: '💎', points: 20, weight: 4,  isBad: false },
		{ glyph: '🌧️', points: -6, weight: 10, isBad: true  }
	];

	// ---- Level definitions (escalates difficulty + theme) ----
	const LEVELS = [
		{ name: 'Level 1 · I’m Sorry', spawnEvery: 850, fallSpeed: 1.4, target: 60 },
		{ name: 'Level 2 · I Miss You', spawnEvery: 650, fallSpeed: 1.9, target: 140 },
		{ name: 'Level 3 · I Love You', spawnEvery: 480, fallSpeed: 2.5, target: 240 }
	];

	const TARGET_SCORE = LEVELS[LEVELS.length - 1].target;

	// ---- DOM nodes (resolved on init) ----
	let overlay, canvas, ctx;
	let scoreEl, levelEl, meterFillEl, bannerEl, introEl, finaleEl;

	// ---- Game state ----
	const state = {
		running: false,
		score: 0,
		levelIndex: 0,
		items: [],
		basketX: 0,
		basketTargetX: 0,
		lastSpawn: 0,
		lastFrame: 0,
		dpr: 1,
		w: 0,
		h: 0,
		bannerTimeout: null,
		keys: { left: false, right: false }
	};

	// ---------------------------------------------------------
	// Public entry point — wired up at DOMContentLoaded
	// ---------------------------------------------------------
	function init() {
		overlay     = document.getElementById('apology-game-overlay');
		canvas      = document.getElementById('apology-game-canvas');
		scoreEl     = document.getElementById('apology-score');
		levelEl     = document.getElementById('apology-level');
		meterFillEl = document.getElementById('apology-meter-fill');
		bannerEl    = document.getElementById('apology-message-banner');
		introEl     = document.getElementById('apology-intro');
		finaleEl    = document.getElementById('apology-finale');

		if (!overlay || !canvas) return;
		ctx = canvas.getContext('2d');

		// Layer that holds DOM-based falling items and sparkles.
		// Created lazily once we know the overlay exists.
		state.fallLayer = document.createElement('div');
		state.fallLayer.className = 'ag-fall-layer';
		overlay.appendChild(state.fallLayer);

		document.getElementById('apology-game-trigger').addEventListener('click', openOverlay);
		document.getElementById('apology-close-btn').addEventListener('click', closeOverlay);
		document.getElementById('apology-start-btn').addEventListener('click', startGame);
		document.getElementById('apology-finale-close').addEventListener('click', closeOverlay);
		document.getElementById('apology-finale-replay').addEventListener('click', function () {
			finaleEl.style.display = 'none';
			resetState();
			showIntro();
		});

		// Pointer / touch / keyboard input
		canvas.addEventListener('mousemove', onPointerMove);
		canvas.addEventListener('touchmove', onTouchMove, { passive: false });
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		window.addEventListener('resize', resizeCanvas);

		// Decorative background hearts
		seedBackgroundHearts();
	}

	// ---------------------------------------------------------
	// Overlay open / close
	// ---------------------------------------------------------
	function openOverlay() {
		overlay.classList.add('ag-open');
		// iOS Safari sometimes hasn't computed the overlay's layout
		// yet when we toggle display. Defer the canvas size to the
		// next frame and re-check shortly after to be safe.
		requestAnimationFrame(resizeCanvas);
		setTimeout(resizeCanvas, 120);
		showIntro();
	}

	function closeOverlay() {
		state.running = false;
		overlay.classList.remove('ag-open');
		clearAllItems();
	}

	function clearAllItems() {
		for (const it of state.items) {
			if (it.el) it.el.remove();
		}
		state.items.length = 0;
		if (state.basketHeartEl) {
			state.basketHeartEl.remove();
			state.basketHeartEl = null;
		}
	}

	function showIntro() {
		introEl.style.display = 'block';
		finaleEl.style.display = 'none';
		hideBanner();
	}

	function startGame() {
		introEl.style.display = 'none';
		// Re-measure right before the loop starts in case the
		// overlay was 0×0 when first opened (iOS Safari quirk).
		resizeCanvas();
		resetState();
		state.running = true;
		state.lastFrame = performance.now();
		state.lastSpawn = performance.now();
		updateHud();
		requestAnimationFrame(loop);
	}

	function resetState() {
		state.score = 0;
		state.levelIndex = 0;
		clearAllItems();
		state.basketX = state.w / 2;
		state.basketTargetX = state.w / 2;
		updateHud();
	}

	// ---------------------------------------------------------
	// Canvas sizing (high-DPI aware)
	// ---------------------------------------------------------
	function resizeCanvas() {
		const dpr = window.devicePixelRatio || 1;
		// Fall back to the viewport if the overlay hasn't been laid
		// out yet (happens on iOS Safari right after toggling
		// display: block). A zero-sized canvas would mean items
		// spawn off-screen and nothing appears to fall.
		let w = overlay.clientWidth  || window.innerWidth  || document.documentElement.clientWidth;
		let h = overlay.clientHeight || window.innerHeight || document.documentElement.clientHeight;
		if (w < 50 || h < 50) { w = window.innerWidth; h = window.innerHeight; }
		canvas.width  = w * dpr;
		canvas.height = h * dpr;
		canvas.style.width  = w + 'px';
		canvas.style.height = h + 'px';
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		state.dpr = dpr;
		state.w = w;
		state.h = h;
		// Recenter basket if it ends up off-screen
		state.basketX = clamp(state.basketX, 60, w - 60);
		state.basketTargetX = state.basketX;
	}

	// ---------------------------------------------------------
	// Input handlers
	// ---------------------------------------------------------
	function onPointerMove(e) {
		const rect = canvas.getBoundingClientRect();
		state.basketTargetX = e.clientX - rect.left;
	}

	function onTouchMove(e) {
		if (e.touches.length > 0) {
			e.preventDefault();
			const rect = canvas.getBoundingClientRect();
			state.basketTargetX = e.touches[0].clientX - rect.left;
		}
	}

	function onKeyDown(e) {
		if (!overlay.classList.contains('ag-open')) return;
		if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') state.keys.left = true;
		if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') state.keys.right = true;
		if (e.key === 'Escape') closeOverlay();
	}

	function onKeyUp(e) {
		if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') state.keys.left = false;
		if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') state.keys.right = false;
	}

	// ---------------------------------------------------------
	// Main game loop
	// ---------------------------------------------------------
	function loop(now) {
		if (!state.running) return;
		const dt = Math.min(40, now - state.lastFrame);
		state.lastFrame = now;

		const level = LEVELS[state.levelIndex];

		// Keyboard movement (when arrows pressed, override pointer target)
		if (state.keys.left)  state.basketTargetX -= 0.6 * dt;
		if (state.keys.right) state.basketTargetX += 0.6 * dt;
		state.basketTargetX = clamp(state.basketTargetX, 60, state.w - 60);

		// Smooth basket easing toward target
		state.basketX += (state.basketTargetX - state.basketX) * 0.22;

		// Spawn new items
		if (now - state.lastSpawn > level.spawnEvery) {
			spawnItem(level);
			state.lastSpawn = now;
		}

		updateItems(level, dt);
		render();

		// Level progression
		const next = LEVELS[state.levelIndex + 1];
		if (next && state.score >= LEVELS[state.levelIndex].target) {
			state.levelIndex++;
			updateHud();
			showBanner('💫 ' + LEVELS[state.levelIndex].name + ' 💫', 1800);
		}

		// Win condition
		if (state.score >= TARGET_SCORE) {
			state.running = false;
			showFinale();
			return;
		}

		requestAnimationFrame(loop);
	}

	// ---------------------------------------------------------
	// Item spawning + physics
	// ---------------------------------------------------------
	function spawnItem(level) {
		const type = pickWeighted(ITEM_TYPES);
		const size = type.isBad ? 36 : (28 + Math.random() * 14);

		// DOM-based item — guaranteed emoji rendering on iOS Safari.
		const el = document.createElement('span');
		el.className = 'ag-fall-item' + (type.isBad ? ' ag-bad' : '');
		el.textContent = type.glyph;
		el.style.fontSize = size + 'px';
		state.fallLayer.appendChild(el);

		state.items.push({
			x: 40 + Math.random() * Math.max(80, state.w - 80),
			y: -30,
			vy: level.fallSpeed * (0.85 + Math.random() * 0.4),
			vx: (Math.random() - 0.5) * 0.6,
			rot: Math.random() * Math.PI * 2,
			vrot: (Math.random() - 0.5) * 0.04,
			size: size,
			type: type,
			el: el
		});
	}

	function updateItems(level, dt) {
		const basketY = state.h - 90;
		const basketHalfWidth = 56;

		for (let i = state.items.length - 1; i >= 0; i--) {
			const it = state.items[i];
			it.y += it.vy * dt * 0.16;
			it.x += it.vx * dt * 0.16;
			it.rot += it.vrot;

			// Position the DOM element (centered on it.x, it.y).
			it.el.style.transform =
				'translate3d(' + (it.x - it.size / 2) + 'px,' +
				(it.y - it.size / 2) + 'px, 0) rotate(' + it.rot + 'rad)';

			// Catch detection
			if (it.y > basketY - 18 && it.y < basketY + 14 &&
				Math.abs(it.x - state.basketX) < basketHalfWidth) {
				if (it.el) it.el.remove();
				state.items.splice(i, 1);
				onCatch(it.type);
				continue;
			}

			// Off-screen
			if (it.y > state.h + 40) {
				if (it.el) it.el.remove();
				state.items.splice(i, 1);
			}
		}
	}

	function onCatch(type) {
		state.score = Math.max(0, state.score + type.points);
		updateHud();
		if (type.isBad) {
			showBanner('Oof — that was a rain cloud! ☁️', 1100);
		} else {
			showBanner(randomLine(), 1500);
			burstSparkles(state.basketX, state.h - 90, type.glyph);
		}
	}

	// ---------------------------------------------------------
	// Rendering
	// ---------------------------------------------------------
	function render() {
		ctx.clearRect(0, 0, state.w, state.h);

		// Faint gradient haze around the basket — pure shapes, works on iOS.
		const grad = ctx.createRadialGradient(
			state.basketX, state.h - 80, 20,
			state.basketX, state.h - 80, 280
		);
		grad.addColorStop(0, 'rgba(255, 105, 180, 0.18)');
		grad.addColorStop(1, 'rgba(255, 105, 180, 0)');
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, state.w, state.h);

		// Falling items + sparkles are rendered as DOM elements
		// (see updateItems / burstSparkles). Only the basket is
		// drawn on canvas — it is composed of plain shapes which
		// every browser, including iOS Safari, handles reliably.
		drawBasket();
	}

	function drawBasket() {
		const x = state.basketX;
		const y = state.h - 80;

		// Glow underneath
		ctx.save();
		ctx.shadowColor = 'rgba(255, 215, 0, 0.7)';
		ctx.shadowBlur = 28;
		ctx.fillStyle = 'rgba(255, 255, 255, 0)';
		ctx.beginPath();
		ctx.ellipse(x, y + 20, 70, 12, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();

		// Basket body (a soft pink heart-bowl)
		ctx.save();
		ctx.translate(x, y);

		// Bowl
		const bowl = ctx.createLinearGradient(0, -30, 0, 30);
		bowl.addColorStop(0, '#ffb6e1');
		bowl.addColorStop(1, '#c2185b');
		ctx.fillStyle = bowl;
		ctx.beginPath();
		ctx.moveTo(-58, -16);
		ctx.quadraticCurveTo(-66, 30, 0, 38);
		ctx.quadraticCurveTo(66, 30, 58, -16);
		ctx.closePath();
		ctx.fill();

		// Rim
		ctx.strokeStyle = '#fff';
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.moveTo(-58, -16);
		ctx.lineTo(58, -16);
		ctx.stroke();

		ctx.restore();

		// The little 💗 above the basket is rendered as a DOM
		// element (positioned in updateBasketHeart) so it renders
		// reliably on iOS Safari.
		updateBasketHeart(x, y - 32);
	}

	function updateBasketHeart(x, y) {
		if (!state.basketHeartEl) {
			const h = document.createElement('span');
			h.className = 'ag-fall-item';
			h.textContent = '💗';
			h.style.fontSize = '26px';
			h.style.zIndex = 6;
			state.fallLayer.appendChild(h);
			state.basketHeartEl = h;
		}
		state.basketHeartEl.style.transform =
			'translate3d(' + (x - 13) + 'px,' + (y - 13) + 'px, 0)';
	}

	// ---------------------------------------------------------
	// Sparkles — DOM-based so emoji renders on every device,
	// animated entirely via CSS (see .ag-sparkle in the CSS).
	// ---------------------------------------------------------
	function burstSparkles(x, y, glyph) {
		for (let i = 0; i < 8; i++) {
			const el = document.createElement('span');
			el.className = 'ag-sparkle';
			el.textContent = Math.random() < 0.5 ? '✨' : glyph;
			el.style.transform = 'translate3d(' + x + 'px,' + y + 'px, 0)';
			// Set CSS variables consumed by the keyframes.
			el.style.setProperty('--ag-dx', ((Math.random() - 0.5) * 160) + 'px');
			el.style.setProperty('--ag-dy', (-60 - Math.random() * 90) + 'px');
			state.fallLayer.appendChild(el);
			setTimeout(function () { el.remove(); }, 900);
		}
	}

	// ---------------------------------------------------------
	// HUD updates and message banner
	// ---------------------------------------------------------
	function updateHud() {
		scoreEl.textContent = state.score + ' / ' + TARGET_SCORE;
		levelEl.textContent = LEVELS[state.levelIndex].name;
		const pct = clamp((state.score / TARGET_SCORE) * 100, 0, 100);
		meterFillEl.style.width = pct + '%';
	}

	function showBanner(text, ms) {
		bannerEl.textContent = text;
		bannerEl.classList.add('ag-show');
		if (state.bannerTimeout) clearTimeout(state.bannerTimeout);
		state.bannerTimeout = setTimeout(hideBanner, ms || 1500);
	}

	function hideBanner() {
		bannerEl.classList.remove('ag-show');
	}

	// ---------------------------------------------------------
	// Finale
	// ---------------------------------------------------------
	function showFinale() {
		hideBanner();
		finaleEl.style.display = 'block';
		// Confetti burst
		for (let i = 0; i < 36; i++) {
			const conf = document.createElement('span');
			conf.className = 'ag-confetti';
			conf.textContent = ['💖','💗','💝','✨','🌹','💕','💞'][Math.floor(Math.random() * 7)];
			conf.style.left = (10 + Math.random() * 80) + 'vw';
			conf.style.top = '-40px';
			conf.style.fontSize = (18 + Math.random() * 22) + 'px';
			conf.style.setProperty('--ag-x', ((Math.random() - 0.5) * 200) + 'px');
			conf.style.animationDelay = (Math.random() * 0.8) + 's';
			conf.style.animationDuration = (2.4 + Math.random() * 1.8) + 's';
			overlay.appendChild(conf);
			setTimeout(function () { conf.remove(); }, 4500);
		}
	}

	// ---------------------------------------------------------
	// Background decorative hearts
	// ---------------------------------------------------------
	function seedBackgroundHearts() {
		const glyphs = ['💗', '💖', '💕', '💞', '🌸'];
		for (let i = 0; i < 14; i++) {
			const span = document.createElement('span');
			span.className = 'ag-bg-heart';
			span.textContent = glyphs[i % glyphs.length];
			span.style.left = (Math.random() * 100) + 'vw';
			span.style.top = (Math.random() * 100) + 'vh';
			span.style.fontSize = (28 + Math.random() * 60) + 'px';
			span.style.animationDelay = (Math.random() * 6) + 's';
			span.style.animationDuration = (8 + Math.random() * 8) + 's';
			overlay.appendChild(span);
		}
	}

	// ---------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------
	function pickWeighted(arr) {
		let total = 0;
		for (const a of arr) total += a.weight;
		let r = Math.random() * total;
		for (const a of arr) {
			if ((r -= a.weight) <= 0) return a;
		}
		return arr[0];
	}

	function clamp(v, lo, hi) {
		return v < lo ? lo : v > hi ? hi : v;
	}

	function randomLine() {
		return APOLOGY_LINES[Math.floor(Math.random() * APOLOGY_LINES.length)];
	}

	// ---------------------------------------------------------
	// Boot
	// ---------------------------------------------------------
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
