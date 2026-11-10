/*
 * three-viewer.js — the 3D species viewer for the Pokedex detail (issue #79,
 * the site's one 3D placement — see DESIGN.md §7: the home-hero run path is
 * the binding pure-CSS signature and the hub/safari diagrams are tested
 * layout surfaces, so the Pokedex species detail is where 3D earns its keep).
 *
 * A deterministic billboard turntable of the in-game sprite: the 128×128
 * species PNG becomes a THREE.CanvasTexture (NearestFilter, no mipmaps —
 * pixel-art crisp) on a plane floating above a minimal floor + grid drawn
 * in the site's CSS tokens.
 *
 * This module is a STATIC script on pokedex.html only (like the other site
 * modules), but it touches nothing — no THREE access, no DOM writes — until
 * js/pages/pokedex.js calls init(), and that only after pokedex.js has
 * resolved the deferred ./vendor/three.min.js injection (the vendored three.js
 * is never in any shell's static markup — DESIGN.md §11).
 *
 * Design contract (DESIGN.md §7):
 *   - Scene colors come ONLY from the CSS tokens: read at init via
 *     getComputedStyle(document.documentElement) on --color-bg (scene
 *     background — the sprite box's own background), --color-surface (floor),
 *     --color-line (grid major), --color-grid (grid minor). A missing or
 *     malformed token fails init and the static <img> stays — nothing
 *     leaves tokens.css.
 *   - Motion (slow turntable + gentle idle bob, one requestAnimationFrame
 *     loop) runs ONLY while matchMedia('(prefers-reduced-motion:
 *     no-preference)') matches. Under reduced motion the scene renders
 *     exactly one static frame (the t=0 pose) and no loop starts —
 *     deterministic for the screenshot pipeline and the UI tests. The loop
 *     also starts/stops live if the media query changes mid-session.
 *   - No WebGL context (or a failed texture load) → the viewer unmounts
 *     itself: the static sprite <img> always occupies the box, so there is
 *     no layout shift and no console error on any failure path.
 *
 * Resource discipline (the "no context leak" guarantee):
 *   - init() is called lazily by the page script when a species detail
 *     first opens.
 *   - ONE WebGL renderer — and therefore one context — per page lifetime:
 *     the renderer, scene, camera, sprite plane and canvas are created on
 *     the first successful init and reused across species; a later init
 *     only swaps the texture. dispose() (called on deselect, version
 *     re-render and every re-init) cancels the rAF loop and removes the
 *     canvas from the DOM, so nothing accumulates under repeated
 *     toggles/deep links. The full teardown (renderer.dispose() +
 *     forceContextLoss() + texture/geometry release) runs only when the
 *     context is actually LOST (webglcontextlost), after which the next
 *     init rebuilds the shared renderer from scratch.
 *   - No per-frame allocations: the loop reads the rAF timestamp and mutates
 *     the sprite group's pose; the clock is a plain number (no per-frame
 *     object creation), the camera is fixed, and lighting is none at all
 *     (unlit MeshBasicMaterial — a fixed scene by construction, no
 *     per-frame RNG).
 *
 * Exposes: window.ROGUE3D = { init(mountEl, spriteSrc) → Boolean, dispose() }
 *   init    mounts the viewer into mountEl (the .dex-viewer box) showing the
 *           sprite at spriteSrc. Returns false — leaving the static <img>
 *           in place — when THREE is absent, a token is malformed, or no
 *           WebGL context can be created. A texture that later fails to
 *           load unmounts itself the same way.
 *   dispose cancels the loop and removes the canvas (the renderer/scene are
 *           kept for reuse, see above). Safe to call when nothing is mounted.
 */
(function () {
  'use strict';

  /* --- constants (the scene's fixed geometry + motion rates) ------------ */

  var MOTION_QUERY = '(prefers-reduced-motion: no-preference)';

  /* Sprite plane (world units): sized so the in-frame art renders at about
   * the same scale as the static <img> fallback (the 128×128 frame fills the
   * box there) — 2.2 high is ~90% of the framed height, the transparent
   * frame margins do the rest. The floor + grid stay readable underneath. */
  var SPRITE_HEIGHT = 2.2;
  var BASE_Y = 1.1; /* sprite center at rest (floor is y=0) */
  var FLOOR_SIZE = 8;
  var GRID_DIVISIONS = 16;

  /* Motion rates — "slow turntable + gentle idle bob": one full turn every
   * ~15.7s, one bob every ~3.7s with a 0.04-unit amplitude. Fixed constants:
   * the pose is a pure function of scene time (deterministic). */
  var TURN_SPEED = 0.4; /* rad/s */
  var BOB_SPEED = 1.7; /* rad/s */
  var BOB_AMPLITUDE = 0.04;

  /* The camera is FIXED — no per-frame movement, no per-frame RNG. The
   * distance leaves headroom so the plane's corners stay in frame through
   * the whole turntable rotation. */
  var CAMERA = { fov: 38, position: [0, 1.6, 3.6], lookAt: [0, 0.9, 0], near: 0.1, far: 50 };

  /* The tokens the scene is drawn from (DESIGN.md §2) — nothing else. */
  var TOKENS = {
    background: '--color-bg',
    floor: '--color-surface',
    gridMajor: '--color-line',
    gridMinor: '--color-grid'
  };

  /* --- shared state ------------------------------------------------------
   * Everything below the renderer is created once (first successful init)
   * and reused across species — init() only swaps the texture. */
  var state = {
    renderer: null, /* THREE.WebGLRenderer — one per page lifetime */
    canvas: null, /* the renderer's canvas (re-parented into the mount) */
    scene: null,
    camera: null,
    group: null, /* the turntable/bob pivot (holds the sprite plane) */
    plane: null, /* the sprite plane (geometry re-fit per texture aspect) */
    material: null, /* sprite plane material (map swapped per species) */
    texture: null, /* the current CanvasTexture (disposed on swap/teardown) */
    raf: 0, /* active requestAnimationFrame id (0 = no loop) */
    lastNow: 0, /* last rAF timestamp (ms) */
    sceneTime: 0, /* seconds the viewer has animated (the pose's clock) */
    noWebGL: false /* a renderer was attempted and failed — don't retry */
  };

  /* In-flight texture-load sequence: every init() and dispose() bumps it,
   * so an Image.onload from a superseded/abandoned init is a no-op. */
  var instanceSeq = 0;

  /* Motion gating — read at load, tracked live (DESIGN.md §7). */
  var motionMq = null;
  var motionOk = false;
  if (typeof window.matchMedia === 'function') {
    motionMq = window.matchMedia(MOTION_QUERY);
    motionOk = !!motionMq.matches;
    if (motionMq.addEventListener) motionMq.addEventListener('change', onMotionChange);
    else if (motionMq.addListener) motionMq.addListener(onMotionChange);
  }

  /* --- token colors ------------------------------------------------------ */

  /**
   * The scene's colors, read from the CSS tokens at init. Returns a map of
   * token name → '#rrggbb', or null when any token is missing/malformed —
   * in that case the caller keeps the static <img> (no scene colors may
   * come from anywhere but tokens.css).
   */
  function readTokenColors() {
    if (typeof window.getComputedStyle !== 'function') return null;
    var styles = window.getComputedStyle(document.documentElement);
    var out = {};
    for (var name in TOKENS) {
      if (!Object.prototype.hasOwnProperty.call(TOKENS, name)) continue;
      var value = styles.getPropertyValue(TOKENS[name]);
      if (typeof value !== 'string') return null;
      value = value.trim();
      if (!/^#[0-9a-fA-F]{3,8}$/.test(value)) return null;
      out[name] = value;
    }
    return out;
  }

  /* --- scene construction (runs once, on the first successful init) ------ */

  function buildScene(colors, mountEl) {
    var THREE = window.THREE;

    var renderer = new THREE.WebGLRenderer({
      antialias: false, /* off is fine (and cheaper) for pixel art */
      alpha: false,
      preserveDrawingBuffer: true /* the frame must survive to the next composite — the reduced-motion single frame and the in-page pixel tests read it back */
    });
    /* Recorded immediately (not at the end): if anything below throws, the
     * caller's destroyShared() still reaches the live renderer and disposes
     * it — a failed build must not strand a WebGL context. */
    state.renderer = renderer;
    var canvas = renderer.domElement;
    state.canvas = canvas;
    canvas.setAttribute('aria-hidden', 'true'); /* decorative — the <img> carries the name */
    canvas.addEventListener('webglcontextlost', onContextLost, false);

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(colors.background);

    var w = Math.max(1, mountEl.clientWidth);
    var h = Math.max(1, mountEl.clientHeight);

    var camera = new THREE.PerspectiveCamera(CAMERA.fov, w / h, CAMERA.near, CAMERA.far);
    camera.position.set(CAMERA.position[0], CAMERA.position[1], CAMERA.position[2]);
    camera.lookAt(new THREE.Vector3(CAMERA.lookAt[0], CAMERA.lookAt[1], CAMERA.lookAt[2]));
    fitRenderer(renderer, camera, w, h);

    /* The minimal floor + grid, in token colors (unlit — fixed by
     * construction). The floor sits a hair below the grid to avoid
     * z-fighting. */
    var floor = new THREE.Mesh(
      new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE),
      new THREE.MeshBasicMaterial({ color: colors.floor })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    scene.add(floor);

    var grid = new THREE.GridHelper(FLOOR_SIZE, GRID_DIVISIONS, new THREE.Color(colors.gridMajor), new THREE.Color(colors.gridMinor));
    scene.add(grid);

    /* The sprite: an unlit double-sided plane (the 2D billboard — a GBA
     * sprite has no real depth, so the "3D" is the turntable, not a model),
     * its size set from the texture's aspect when the texture is applied. */
    var group = new THREE.Group();
    var material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true });
    var plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    group.add(plane);
    group.position.y = BASE_Y;
    scene.add(group);

    state.plane = plane;

    state.scene = scene;
    state.camera = camera;
    state.group = group;
    state.material = material;
  }

  /** Fit the renderer + camera to the mount box (DPR-aware, capped at 2). */
  function fitRenderer(renderer, camera, w, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2); /* DPR-aware, capped */
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false); /* CSS (the .dex-viewer canvas rule) owns the display size */
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /**
   * The sprite PNG → CanvasTexture (pixel-art crisp): drawn 1:1 onto a
   * scratch canvas at native size, NearestFilter for mag AND min, no
   * mipmaps (required with nearest min — and the 128×128 art needs none),
   * sRGB so the palette renders exactly as the token-palette PNG shows it.
   */
  function makeTexture(img) {
    var THREE = window.THREE;
    var w = img.naturalWidth || img.width || 128;
    var h = img.naturalHeight || img.height || 128;
    var scratch = document.createElement('canvas');
    scratch.width = w;
    scratch.height = h;
    var ctx = scratch.getContext('2d');
    if (!ctx) throw new Error('no 2d context for the sprite texture');
    ctx.drawImage(img, 0, 0);
    var texture = new THREE.CanvasTexture(scratch);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.userData.aspect = w / h;
    return texture;
  }

  /* --- the pose + the loop ------------------------------------------------ */

  /** The pose as a pure function of scene time (the determinism core). */
  function pose(t) {
    state.group.rotation.y = t * TURN_SPEED;
    state.group.position.y = BASE_Y + Math.sin(t * BOB_SPEED) * BOB_AMPLITUDE;
  }

  /** Exactly one static frame at the current scene time (reduced motion). */
  function renderStatic() {
    pose(state.sceneTime);
    state.renderer.render(state.scene, state.camera);
  }

  function tick(now) {
    if (!state.raf || !state.renderer) return;
    /* Clamp the step (a background tab pauses rAF — don't jump the pose on
     * resume); plain numbers only, no per-frame allocations. */
    var dt = (now - state.lastNow) / 1000;
    if (dt > 0.1) dt = 0.1;
    state.sceneTime += dt;
    state.lastNow = now;
    pose(state.sceneTime);
    state.renderer.render(state.scene, state.camera);
    state.raf = window.requestAnimationFrame(tick);
  }

  function startLoop() {
    if (state.raf || !state.scene || !state.renderer) return;
    state.lastNow = window.performance.now();
    state.raf = window.requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (state.raf) {
      window.cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
  }

  /** Motion end state for the current media state (one frame vs the loop). */
  function applyMotionState() {
    if (!state.scene || !state.renderer) return;
    if (motionOk) startLoop();
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

  /* --- unmount / teardown -------------------------------------------------- */

  /**
   * The canvas leaves the DOM (the static <img> underneath is untouched —
   * no layout shift). The renderer/scene/canvas are KEPT: one WebGL context
   * per page lifetime, reused by the next init.
   */
  function unmount() {
    stopLoop();
    if (state.canvas && state.canvas.parentNode) {
      state.canvas.parentNode.removeChild(state.canvas);
    }
  }

  /**
   * Full teardown — only after an actual context loss, where the shared
   * renderer is dead: release textures/geometry/materials, dispose the
   * renderer and force the (already lost) context down so the next init
   * starts from a clean slate.
   */
  function destroyShared() {
    unmount();
    if (state.texture) {
      state.texture.dispose();
      state.texture = null;
    }
    if (state.scene) {
      state.scene.traverse(function (obj) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (var i = 0; i < mats.length; i++) mats[i].dispose();
        }
      });
    }
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
    state.scene = null;
    state.camera = null;
    state.group = null;
    state.plane = null;
    state.material = null;
  }

  function onContextLost(event) {
    if (event && event.preventDefault) event.preventDefault(); /* don't auto-restore a dead context — rebuild fresh */
    destroyShared();
  }

  /* --- the public API ------------------------------------------------------ */

  /**
   * Mount (or re-mount) the viewer in mountEl, showing spriteSrc. The shared
   * renderer/scene are created on first success and reused afterwards (the
   * texture is the only per-species thing). Returns false when the viewer
   * cannot start (no THREE, malformed tokens, no WebGL) — the static <img>
   * stays. A texture that fails to load unmounts itself via the same path.
   */
  function init(mountEl, spriteSrc) {
    if (!window.THREE || !mountEl || typeof spriteSrc !== 'string') return false;

    var colors = readTokenColors();
    if (!colors) return false; /* token missing/malformed → stay static */

    instanceSeq++; /* invalidate any in-flight texture load from a prior init */
    stopLoop();

    if (state.scene && state.renderer) {
      /* Reuse the shared scene (one context per page lifetime): re-fit in
       * case the box changed, and let the texture swap below do the rest. */
      fitRenderer(state.renderer, state.camera, Math.max(1, mountEl.clientWidth), Math.max(1, mountEl.clientHeight));
    } else if (state.noWebGL) {
      return false; /* a renderer was attempted already and failed */
    } else {
      try {
        buildScene(colors, mountEl);
      } catch (e) {
        state.noWebGL = true; /* no WebGL context available → the static <img> stays */
        destroyShared();
        return false;
      }
    }

    /* The sprite (async): only when THIS init is still current does the
     * load land — dispose()/init() bump instanceSeq and void stale loads. */
    var id = instanceSeq;
    var image = new Image();
    image.onload = function () {
      if (instanceSeq !== id || !state.scene || !state.renderer) return;
      try {
        var texture = makeTexture(image);
        if (state.texture) state.texture.dispose();
        state.texture = texture;
        state.material.map = texture;
        state.material.needsUpdate = true;
        /* Size the plane from the texture's aspect (the art is square, but
         * don't assume it). */
        var aspect = texture.userData.aspect || 1;
        state.plane.geometry.dispose();
        state.plane.geometry = new window.THREE.PlaneGeometry(SPRITE_HEIGHT * aspect, SPRITE_HEIGHT);
        applyMotionState(); /* reduced motion: exactly one frame; else: the loop */
        mountEl.appendChild(state.canvas); /* re-parent into the (re-)rendered mount */
      } catch (e) {
        unmount(); /* texture/scene failure → the static <img> stays, silently */
      }
    };
    image.onerror = function () {
      if (instanceSeq !== id) return;
      unmount(); /* texture load failure → the static <img> stays, silently */
    };
    image.src = spriteSrc;
    return true;
  }

  /**
   * Cancel the loop and remove the canvas (deselect, version re-render and
   * every re-init call this first). The shared renderer/scene are kept for
   * the next init (one context per page lifetime). Safe when unmounted.
   */
  function dispose() {
    instanceSeq++;
    unmount();
  }

  window.ROGUE3D = {
    init: init,
    dispose: dispose
  };
})();
