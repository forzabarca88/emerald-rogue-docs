/*
 * three-scene.js — the site's shared 3D foundation (issue #79).
 *
 * One self-contained IIFE module (the same plain-JS, zero-dependency,
 * window-global style as the other site/js modules) that owns ALL of the
 * site's WebGL discipline. Every 3D placement mounts through it: the
 * Pokedex species detail is the first placement live (its GBA-affine-style
 * sway scene is supplied by pages/pokedex.js as the `build` callback) and
 * the home-hero run path is the second (its token-coloured-box scene is
 * supplied by pages/home.js, built from the same HERO_PATH that emits the
 * binding pure-CSS fallback markup).
 *
 * This module is INERT until a page calls ROGUE3D.load() and ROGUE3D.mount()
 * — no THREE access, no DOM writes, no listeners that do anything until
 * then. It is loaded as a STATIC script tag (on the pages that host 3D)
 * like the other site modules. The vendored three.js (./vendor/three.min.js)
 * is loaded in exactly ONE place on the whole site: ROGUE3D.load() below,
 * as a deferred <script> injection — never in any shell's static markup
 * (DESIGN.md §11; the e2e vendor guard asserts the shells contain no
 * reference to it).
 *
 * Design contract (DESIGN.md §7):
 *   - Scene colors come ONLY from named --color-* tokens: the caller's
 *     `tokens` map (role → '--color-*' custom-property name) is read at
 *     mount time via getComputedStyle(document.documentElement). A missing
 *     or malformed token (not a #hex literal) ABORTS the mount — the
 *     static fallback layer stays, and nothing leaves tokens.css.
 *   - Motion: ONE requestAnimationFrame loop runs ONLY while
 *     matchMedia('(prefers-reduced-motion: no-preference)') matches, and
 *     the query is tracked LIVE (a change listener flips the end state
 *     mid-session: no-preference → the loop, restarted from t=0; reduce →
 *     the loop is cancelled and exactly ONE static frame at t=0 is
 *     rendered — deterministic for the screenshot pipeline). If build()
 *     returns no pose, exactly one frame renders and no loop runs, under
 *     either media state (nothing in the scene can change frame-to-frame
 *     — an idle loop would only burn frames).
 *   - No WebGL context, or a build() that throws → the mount aborts
 *     WITHOUT adding a canvas: the static fallback layer stays — no
 *     layout shift, no console error on any failure path.
 *   - A runtime render failure (a throw out of renderer.render(), e.g.
 *     a driver dropping the context mid-frame) is handled like a
 *     context loss: the loop stops and the full teardown below runs —
 *     no pageerror escapes on any failure path.
 *   - webglcontextlost → FULL teardown (the per-mount scene objects,
 *     the shared renderer, forceContextLoss()) and the NEXT mount
 *     rebuilds from scratch.
 *   - Performance discipline: ONE shared THREE.WebGLRenderer — hence ONE
 *     WebGL context — per page lifetime (created on the first successful
 *     mount, reused across mounts, deliberately KEPT across dispose());
 *     the scene/camera and all of their objects are PER-MOUNT and are
 *     disposed on unmount. devicePixelRatio is capped at 2, antialias is
 *     off, scenes are unlit (unlit MeshBasicMaterial is the house style —
 *     no lights, no shadows), and there are NO per-frame allocations: the
 *     loop reads the rAF timestamp, advances a plain-number scene clock,
 *     calls the caller's pose(t) and renders.
 *
 * Exposes: window.ROGUE3D = { load(), mount(mountEl, { tokens, build }) →
 * Promise<Boolean>, dispose() }
 *
 *   load() → Promise<Boolean>
 *       Injects a deferred <script src="./vendor/three.min.js"> ONCE —
 *       this is the ONE place the vendored three.js is ever loaded — and
 *       resolves true only when window.THREE is present (a script that
 *       "loads" but defines nothing — a corrupt vendor file — resolves
 *       false, like a load failure). If THREE is already present it
 *       resolves immediately (no injection); the promise is memoized for
 *       the page lifetime and a load failure (the script errors, or loads
 *       without defining window.THREE) resolves false and is NEVER
 *       retried (a missing or corrupt vendor file is not a transient
 *       fault).
 *
 *   mount(mountEl, { tokens, build }) → Promise<Boolean>
 *       mountEl   the element the canvas will fill. The caller's CSS owns
 *                 the box's display size (the house pattern is an
 *                 absolutely-positioned inset:0 canvas over a static
 *                 fallback layer in the same box); the foundation sizes
 *                 the drawing buffer to the element's client box at mount
 *                 and re-fits (renderer size + camera aspect, then the
 *                 placement's optional refit hook) on window resize while
 *                 mounted, re-rendering the static frame when no loop is
 *                 running (the reduced-motion end state stays one frame).
 *       tokens    an object of role → '--color-*' custom-property name
 *                 (e.g. { background: '--color-bg' }). Each named token is
 *                 read once at mount via getComputedStyle(document.
 *                 documentElement); the trimmed '#'-hex values are handed
 *                 to build() as its 4th argument (`colors`), keyed by
 *                 role. A missing or malformed token ABORTS the mount
 *                 (resolves false, no canvas — the static fallback stays).
 *       build     function(THREE, scene, camera, colors) — called
 *                 synchronously with the FRESH per-mount scene/camera. It
 *                 adds the placement's objects (unlit MeshBasicMaterial
 *                 scenes), may configure the camera (the foundation
 *                 creates a default PerspectiveCamera and sets
 *                 camera.aspect + updateProjectionMatrix() AFTER build,
 *                 since build may re-set fov/near/far), and may return:
 *                 - pose(t): a PURE function of scene time (seconds since
 *                 the loop (re)started — the clock restarts at 0 each time
 *                 the loop starts) that MUTATES PRE-BUILT objects only,
 *                 with NO per-frame allocations. Returning undefined/null
 *                 mounts a static scene (exactly one frame, no loop).
 *                 - or an object { pose?, refit? } carrying that same
 *                 pose(t) plus an OPTIONAL refit(aspect): called by the
 *                 foundation whenever it re-fits the mount — once after
 *                 build (before the first frame) and again on every live
 *                 window resize, BEFORE the re-render — for placements
 *                 whose camera fit depends on the box's aspect (the home
 *                 hero's aspect-derived vertical fov). refit has no
 *                 per-frame cost: it only runs on (re)fit.
 *                 If build() throws, the mount aborts (resolves false, no
 *                 canvas; the half-built scene's objects are disposed).
 *       Returns a promise resolving true when the mount is live (the
 *       canvas is in mountEl and the loop or single static frame has
 *       started) or false when it aborted (no THREE present, a token is
 *       missing/malformed, no WebGL context, build threw). Calling mount()
 *       replaces any active mount (it disposes first); callers that
 *       re-mount (e.g. on every detail render) should call dispose() first
 *       for an explicit boundary. The shared renderer persists across
 *       mount/dispose (one context per page lifetime).
 *
 *   dispose()
 *       Cancels the rAF loop, removes the canvas from the DOM (the static
 *       fallback layer underneath is untouched — no layout shift) and
 *       disposes the per-mount scene objects (geometries, materials and
 *       their texture maps). The shared renderer and its canvas element
 *       are deliberately KEPT for the next mount — do NOT "fix" this into
 *       per-deselect context teardown: one WebGL context per page
 *       lifetime IS the contract. Safe to call when nothing is mounted.
 */
(function () {
  'use strict';

  var MOTION_QUERY = '(prefers-reduced-motion: no-preference)';

  /* The ONE place the vendored three.js is ever loaded (DESIGN.md §11). */
  var THREE_SRC = './vendor/three.min.js';

  /* --- shared state -------------------------------------------------------
   * The renderer/canvas exist once per page lifetime (created on the first
   * successful mount, kept across dispose()); everything below them is
   * per-mount. */
  var state = {
    renderer: null, /* THREE.WebGLRenderer — one per page lifetime */
    canvas: null, /* the renderer's canvas (re-parented into the mount) */
    scene: null, /* per-mount scene */
    camera: null, /* per-mount camera */
    mountEl: null, /* the element the canvas currently fills */
    pose: null, /* the caller's pose(t), if build() returned one */
    refit: null, /* the caller's refit(aspect), if build() returned { pose, refit } */
    raf: 0, /* active requestAnimationFrame id (0 = no loop) */
    lastNow: 0, /* last rAF timestamp (ms) */
    sceneTime: 0, /* seconds since the loop (re)started — the pose's clock */
    noWebGL: false, /* a renderer was attempted and failed — don't retry */
    threeLoad: null /* the memoized load() promise */
  };

  /* Motion gating — read at load, tracked live (DESIGN.md §7). */
  var motionMq = null;
  var motionOk = false;
  if (typeof window.matchMedia === 'function') {
    motionMq = window.matchMedia(MOTION_QUERY);
    motionOk = !!motionMq.matches;
    if (motionMq.addEventListener) motionMq.addEventListener('change', onMotionChange);
    else if (motionMq.addListener) motionMq.addListener(onMotionChange);
  }

  /* --- token colors -------------------------------------------------------- */

  /**
   * The scene's colors, read from the caller's named --color-* tokens at
   * mount. Returns a map of role → trimmed '#'-hex, or null when `tokens`
   * is absent or any named token is missing/malformed — in that case the
   * caller's static fallback layer stays (no scene color may come from
   * anywhere but tokens.css).
   */
  function readTokenColors(tokens) {
    if (!tokens || typeof tokens !== 'object') return null;
    if (typeof window.getComputedStyle !== 'function') return null;
    var styles = window.getComputedStyle(document.documentElement);
    var out = {};
    for (var role in tokens) {
      if (!Object.prototype.hasOwnProperty.call(tokens, role)) continue;
      var value = styles.getPropertyValue(tokens[role]);
      if (typeof value !== 'string') return null;
      value = value.trim();
      if (!/^#[0-9a-fA-F]{3,8}$/.test(value)) return null;
      out[role] = value;
    }
    return out;
  }

  /* --- fitting -------------------------------------------------------------- */

  /** Fit the shared renderer + the per-mount camera to the mount box
   *  (DPR-aware, capped at 2). The caller's CSS owns the display size. */
  function fit(mountEl) {
    var w = Math.max(1, mountEl.clientWidth);
    var h = Math.max(1, mountEl.clientHeight);
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    state.renderer.setSize(w, h, false);
    state.camera.aspect = w / h;
    if (state.refit) state.refit(state.camera.aspect); /* the placement's aspect-dependent fit (e.g. an aspect-derived fov) */
    state.camera.updateProjectionMatrix();
  }

  /* --- the pose loop --------------------------------------------------------- */

  /** One frame of the loop: plain numbers only, no per-frame allocations. */
  function tick(now) {
    if (!state.raf || !state.renderer || !state.scene || !state.pose) {
      state.raf = 0;
      return;
    }
    /* Clamp the step (a background tab pauses rAF — don't jump the pose on
     * resume). */
    var dt = (now - state.lastNow) / 1000;
    if (dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    state.lastNow = now;
    state.sceneTime += dt;
    state.pose(state.sceneTime);
    try {
      state.renderer.render(state.scene, state.camera);
    } catch (e) {
      /* a runtime render throw (a driver dropping the context mid-frame)
       * is handled like a context loss: stop the loop, full teardown —
       * no pageerror escapes on any failure path */
      state.raf = 0;
      onContextLost(null);
      return;
    }
    state.raf = window.requestAnimationFrame(tick);
  }

  function startLoop() {
    if (state.raf || !state.scene || !state.renderer || !state.pose) return;
    /* Deterministic start: the pose is a pure function of scene time, and
     * the clock restarts at 0 each time the loop (re)starts — a live
     * media-query flip back to no-preference re-poses from the same t=0
     * pose the reduced-motion frame shows. */
    state.sceneTime = 0;
    state.lastNow = window.performance.now();
    state.raf = window.requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (state.raf) {
      window.cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
  }

  /** Exactly one static frame at t=0 (reduced motion, or a no-pose scene). */
  function renderStatic() {
    if (state.pose) state.pose(0);
    try {
      state.renderer.render(state.scene, state.camera);
    } catch (e) {
      /* the same contract as the loop's render: full teardown, no pageerror */
      state.raf = 0;
      onContextLost(null);
    }
  }

  /** The motion end state for the current media state (loop vs one frame). */
  function applyMotionState() {
    if (!state.scene || !state.renderer) return;
    if (motionOk && state.pose) startLoop();
    else {
      stopLoop();
      renderStatic();
    }
  }

  /** Live media-query flip (user toggles reduced motion mid-session). */
  function onMotionChange() {
    if (!motionMq) return;
    motionOk = !!motionMq.matches;
    if (!state.scene || !state.canvas || !state.canvas.parentNode) return; /* not mounted — nothing to do */
    applyMotionState();
  }

  /* --- unmount / teardown ----------------------------------------------------- */

  /** Dispose the per-mount scene's objects (geometries, materials, maps). */
  function disposeSceneObjects() {
    if (!state.scene) return;
    state.scene.traverse(function (obj) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (var i = 0; i < mats.length; i++) {
          if (mats[i].map) mats[i].map.dispose(); /* texture maps are not freed by material.dispose() */
          mats[i].dispose();
        }
      }
    });
  }

  /**
   * Unmount: the loop stops, the canvas leaves the DOM (the static
   * fallback layer underneath is untouched — no layout shift) and the
   * per-mount scene objects are disposed. The shared renderer and its
   * canvas element are KEPT: one WebGL context per page lifetime, reused
   * by the next mount. Safe when nothing is mounted.
   */
  function unmount() {
    stopLoop();
    if (state.canvas && state.canvas.parentNode) {
      state.canvas.parentNode.removeChild(state.canvas);
    }
    disposeSceneObjects();
    state.scene = null;
    state.camera = null;
    state.pose = null;
    state.refit = null;
    state.mountEl = null;
  }

  /**
   * FULL teardown — only after an actual context loss, where the shared
   * renderer is dead: unmount, dispose the renderer and force the
   * (already lost) context down so the next mount starts from a clean
   * slate.
   */
  function destroyShared() {
    unmount();
    if (state.renderer) {
      state.renderer.dispose();
      try {
        state.renderer.forceContextLoss();
      } catch (e) {
        /* the WEBGL_lose_context extension is absent — the context is lost
         * already, so there is nothing more to do */
      }
    }
    state.renderer = null;
    state.canvas = null;
  }

  function onContextLost(event) {
    if (event && event.preventDefault) event.preventDefault(); /* don't auto-restore a dead context — rebuild fresh */
    destroyShared();
  }

  /** Re-fit a live mount on window resize (responsive stages — the caller's
   *  box may change with the viewport; the drawing buffer + camera aspect
   *  must track it, or the frame stretches). When no loop is running
   *  (reduced motion, or a no-pose scene) the re-fit clears the buffer,
   *  so the static frame is re-rendered — the end state stays one frame. */
  function onResize() {
    if (!state.scene || !state.renderer || !state.mountEl) return;
    if (!state.canvas || !state.canvas.parentNode) return;
    fit(state.mountEl);
    if (!state.raf) renderStatic();
  }
  window.addEventListener('resize', onResize);

  /* --- the public API ---------------------------------------------------------- */

  /**
   * The ONE place the vendored three.js is ever loaded: a deferred
   * <script> injection, promise-memoized for the page lifetime. Resolves
   * true only when window.THREE is present (already loaded → immediately,
   * no injection); false — never retried — if the script fails to load,
   * or loads without defining window.THREE (a corrupt vendor file).
   */
  function load() {
    if (window.THREE) return Promise.resolve(true);
    if (state.threeLoad) return state.threeLoad;
    state.threeLoad = new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = THREE_SRC;
      script.onload = function () {
        resolve(!!window.THREE); /* a script that "loads" but defines nothing is a failure too */
      };
      script.onerror = function () {
        resolve(false);
      };
      document.body.appendChild(script);
    });
    return state.threeLoad;
  }

  /**
   * Mount (or re-mount) a placement in mountEl via the caller's build()
   * callback. The shared renderer is created on the first success and
   * reused afterwards; the scene/camera are per-mount. Resolves false
   * when the mount cannot start (no THREE, a token missing/malformed, no
   * WebGL, build threw) — the caller's static fallback layer simply stays.
   */
  function mount(mountEl, options) {
    if (!mountEl || !options || typeof options.build !== 'function') {
      return Promise.resolve(false);
    }
    var THREE = window.THREE;
    if (!THREE) return Promise.resolve(false); /* call load() first */

    var colors = readTokenColors(options.tokens);
    if (!colors) return Promise.resolve(false); /* token missing/malformed → the fallback stays */

    unmount(); /* a mount replaces any active mount (dispose first) */

    /* The shared renderer — one WebGL context per page lifetime. */
    if (!state.renderer) {
      if (state.noWebGL) return Promise.resolve(false); /* a renderer was attempted already and failed */
      try {
        var renderer = new THREE.WebGLRenderer({
          antialias: false, /* off is fine (and cheaper) for pixel art */
          alpha: false,
          preserveDrawingBuffer: true /* the frame must survive to the next composite — the reduced-motion single frame and the in-page pixel tests read it back */
        });
        state.renderer = renderer;
        state.canvas = renderer.domElement;
        state.canvas.setAttribute('aria-hidden', 'true'); /* decorative — the fallback layer carries the name */
        state.canvas.addEventListener('webglcontextlost', onContextLost, false);
      } catch (e) {
        state.noWebGL = true; /* no WebGL context available → the fallback stays */
        return Promise.resolve(false);
      }
    }

    /* The per-mount scene + camera + the caller's content. */
    try {
      var scene = new THREE.Scene();
      state.scene = scene;
      var camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      state.camera = camera;
      var ret = options.build(THREE, scene, camera, colors);
      /* build may return pose(t) directly, or an object { pose?, refit? }
       * — the refit hook re-applies the placement's aspect-dependent
       * camera fit on every foundation (re)fit (the home hero's
       * aspect-derived vertical fov). */
      var pose = null;
      var refit = null;
      if (typeof ret === 'function') pose = ret;
      else if (ret && typeof ret === 'object') {
        if (typeof ret.pose === 'function') pose = ret.pose;
        if (typeof ret.refit === 'function') refit = ret.refit;
      }
      state.pose = pose;
      state.refit = refit;
      state.mountEl = mountEl;
      fit(mountEl); /* after build — the caller may have re-set fov/near/far */
      mountEl.appendChild(state.canvas);
      applyMotionState();
      return Promise.resolve(true);
    } catch (e) {
      unmount(); /* dispose the half-built scene's objects; the shared renderer survives */
      return Promise.resolve(false);
    }
  }

  /**
   * Cancel the loop, remove the canvas and dispose the per-mount scene
   * objects. The shared renderer is deliberately KEPT for the next mount
   * (one WebGL context per page lifetime — do NOT "fix" this into
   * per-deselect context teardown). Safe to call when nothing is mounted.
   */
  function dispose() {
    unmount();
  }

  window.ROGUE3D = {
    load: load,
    mount: mount,
    dispose: dispose
  };
})();
