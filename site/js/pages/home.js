/*
 * pages/home.js — home page. The hero is built around the run-path
 * signature element (DESIGN.md §5.1): eyebrow, title and subtitle from
 * data/site.json, the run-path stage — the pure-CSS path as the no-JS /
 * no-WebGL fallback layer, with the 3D canvas (the site's second 3D
 * placement, issue #79, on the shared js/three-scene.js foundation)
 * mounted over it when WebGL is available — and the stat blocks. Below
 * the hero: quick-link cards for every other nav page, then the "About
 * these docs" prose. All content comes from data/site.json.
 *
 * The hero re-renders on version toggle (ROGUE.onChange) like the other
 * data pages: the re-render disposes the live 3D mount and re-mounts it
 * through the foundation's shared renderer (one WebGL context per page
 * lifetime — no leaks, no second context).
 */
(function () {
  'use strict';

  /* --- The hero run path — ONE source of truth (DESIGN.md §5.1) -----------
   * HERO_PATH is the single node/link/lanes structure the hero's signature
   * path is built from. It emits BOTH the binding pure-CSS markup
   * (runPathMarkup() — byte-identical to the contract comment above
   * .run-path in site/css/pages.css) and the 3D scene content
   * (buildHeroScene) — the path definition is never duplicated.
   *
   * Step kinds:
   *   { kind: 'node', type?: 'hub' | 'rest' | 'boss' }  a node (no type = route)
   *   { kind: 'link' }                                  the gap to the next node
   *   { kind: 'fork', lanes: [ [steps…], … ] }          the fork — one lane per step list
   *
   * 3D layout (world units; the whole path group is centred on its midpoint
   * and the camera looks at the origin):
   *   - nodes are 1×1 tiles one PITCH apart along +x; a 'link' is one PITCH
   *     of gap, and every node connects from ALL of the previous step's
   *     end positions — so the fork's single CSS link becomes one thin
   *     diagonal per lane (the lanes diverge, then converge on the boss);
   *   - a fork's lanes sit at z = ±LANE_Z (per lane, evenly spaced when
   *     there are more than two);
   *   - the hub and boss are tall; the boss is a 45°-rotated gold diamond
   *     (the CSS path's rotated square, in 3D).
   */
  var HERO_PATH = [
    { kind: 'node', type: 'hub' },
    { kind: 'link' },
    { kind: 'node' },
    { kind: 'link' },
    {
      kind: 'fork',
      lanes: [
        [{ kind: 'node' }, { kind: 'link' }, { kind: 'node' }],
        [{ kind: 'node', type: 'rest' }, { kind: 'link' }, { kind: 'node' }]
      ]
    },
    { kind: 'link' },
    { kind: 'node', type: 'boss' }
  ];

  /** The binding pure-CSS markup (DESIGN.md §5.1) — the hero carries exactly
   *  this string, byte-identical to the contract comment in pages.css. */
  function runPathMarkup() {
    function nodeSpan(step) {
      return (
        '<span class="run-path__node' +
        (step.type ? ' run-path__node--' + step.type : '') +
        '"></span>'
      );
    }
    function stepHtml(step) {
      if (step.kind === 'node') return nodeSpan(step);
      if (step.kind === 'link') return '<span class="run-path__link"></span>';
      return (
        '<span class="run-path__fork">' +
        step.lanes
          .map(function (lane) {
            return '<span class="run-path__lane">' + lane.map(stepHtml).join('') + '</span>';
          })
          .join('') +
        '</span>'
      );
    }
    return '<div class="run-path" aria-hidden="true">' + HERO_PATH.map(stepHtml).join('') + '</div>';
  }

  /* --- the 3D hero scene (issue #79) — built from the same HERO_PATH ------
   * Scene constants (world units): the geometry above, the FIXED camera
   * (a downward tilt at the origin — the only per-frame change is the
   * whole-group yaw drift in the returned pose). The scene is FIT to the
   * stage's client box (fitScene): the vertical field-of-view is derived
   * from the aspect so the path's world bounding box fills the stage
   * without clipping — applied at build AND re-applied on every live
   * resize through the foundation's refit hook (the foundation sets
   * camera.aspect after build / on resize, then calls refit(aspect)).
   * Colors come ONLY from the named --color-* tokens below. */
  var SCENE = {
    pitch: 1.9, /* node-to-node centre distance (= one link gap) */
    node: 1.0, /* tile footprint (x × z) */
    tileH: 0.22, /* route/rest tile height */
    hubH: 0.5, /* hub + boss box height */
    linkH: 0.12, /* thin link height */
    linkD: 0.3, /* thin link depth */
    laneZ: 0.85, /* fork lane divergence, per lane, in ±z */
    camY: 3.4, /* fixed camera — the downward tilt */
    camZ: 3.6,
    fillW: 0.9, /* the path spans at most this fraction of the stage width */
    fillEdge: 0.9 /* … and no vertical edge goes past this fraction of the half-height */
  };
  var YAW_SPEED = 0.3; /* rad/s — the slow yaw drift */
  var YAW_MAX = 0.24; /* rad (~14°) — its amplitude */

  /**
   * Fit the scene to the stage's client box. The path's world bounding box
   * is W wide in x (the hub's left edge to the boss's 45° diamond tip) and
   * spans ±E in z (the lane footprints); from the camera at (0, camY, camZ)
   * looking at the origin, a world point at z projects to vertical NDC
   * -camY·z/(X·(d²−camZ·z)) with X = tan(fov/2) — so the vertical fov is
   * the max of the width-fit and the vertical-edge-fit, and a first-order
   * group z-shift (−(vBot−vTop)·d²/2camY) centres the band (the
   * camera-side lane projects lower than the far side).
   */
  function fitScene(aspect) {
    var lastX = walkX(HERO_PATH, 0);
    var W = lastX + SCENE.node / 2 + (SCENE.node * Math.SQRT2) / 2; /* full x extent */
    var E = SCENE.laneZ + SCENE.node / 2; /* lane z extent */
    var d2 = SCENE.camY * SCENE.camY + SCENE.camZ * SCENE.camZ;
    var vTop = (SCENE.camY * E) / (d2 + SCENE.camZ * E); /* far-side edge, in NDC × X */
    var vBot = (SCENE.camY * E) / (d2 - SCENE.camZ * E); /* camera-side edge, in NDC × X */
    var tanV = Math.max(
      W / (2 * SCENE.fillW * Math.sqrt(d2) * aspect),
      Math.max(vTop, vBot) / SCENE.fillEdge
    );
    return {
      lastX: lastX,
      fov: (2 * Math.atan(tanV) * 180) / Math.PI,
      z: -((vBot - vTop) * d2) / (2 * SCENE.camY)
    };
  }

  var HERO_SCENE_TOKENS = {
    background: '--color-bg', /* the plain backdrop (the .hero-stage box's own background) */
    hub: '--color-emerald', /* the hub box */
    route: '--color-line', /* route tiles + the thin link boxes */
    rest: '--color-raised', /* the rest-stop tile (the CSS path's dimmed, dashed stop) */
    boss: '--color-gold' /* the boss diamond */
  };

  /** Walk HERO_PATH once for a number, exactly as buildHeroScene places it:
   *  nodes sit at the current x, a link advances one PITCH, a fork walks
   *  each lane from the current x (the longest lane ends the fork). */
  function walkX(steps, x) {
    for (var i = 0; i < steps.length; i++) {
      var step = steps[i];
      if (step.kind === 'link') x += SCENE.pitch;
      else if (step.kind === 'fork') {
        var end = x;
        for (var li = 0; li < step.lanes.length; li++) {
          var laneEnd = walkX(step.lanes[li], x);
          if (laneEnd > end) end = laneEnd;
        }
        x = end;
      }
    }
    return x;
  }

  /**
   * The hero's build callback for ROGUE3D.mount: the fitted camera, the
   * plain token backdrop and the unlit token-coloured boxes walked from
   * HERO_PATH (hub emerald, route tiles + thin links in the line hue, the
   * rest stop in the moss hue, the fork as the lanes diverging in depth,
   * the boss a 45°-rotated gold diamond). Returns the slow yaw-drift
   * pose(t) — a pure function of scene time mutating the pre-built group
   * only (no camera movement, no per-frame allocations).
   */
  function buildHeroScene(THREE, scene, camera, colors, stage) {
    var aspect = Math.max(1, stage.clientWidth) / Math.max(1, stage.clientHeight);
    camera.position.set(0, SCENE.camY, SCENE.camZ);
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    /* the plain --color-bg backdrop (the .hero-stage box paints the same
     * --color-bg surface in CSS, so both states look identical) */
    scene.background = new THREE.Color(colors.background);

    var group = new THREE.Group();
    group.position.x = -fitScene(aspect).lastX / 2; /* centre the path on the camera target */
    scene.add(group);

    /* The aspect-dependent fit (the vertical fov + the band's vertical
     * centre): the foundation's fit hook applies it once after build
     * (before the first frame) and again on every live resize, so the
     * fov is never frozen at the mount aspect. */
    function applyFit(a) {
      var fit = fitScene(a);
      camera.fov = fit.fov;
      camera.near = 0.1;
      camera.far = 100;
      group.position.z = fit.z; /* centre the band vertically in the stage */
    }

    function box(w, h, d, color) {
      return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: color }));
    }

    function addNode(type, x, z) {
      var mesh;
      if (type === 'hub') mesh = box(SCENE.node, SCENE.hubH, SCENE.node, colors.hub);
      else if (type === 'boss') {
        mesh = box(SCENE.node, SCENE.hubH, SCENE.node, colors.boss);
        mesh.rotation.y = Math.PI / 4; /* the gold diamond (the CSS rotated square) */
      } else if (type === 'rest') mesh = box(SCENE.node, SCENE.tileH, SCENE.node, colors.rest);
      else mesh = box(SCENE.node, SCENE.tileH, SCENE.node, colors.route);
      mesh.position.set(x, 0, z);
      group.add(mesh);
    }

    function addLink(fromX, fromZ, toX, toZ) {
      var dx = toX - fromX;
      var dz = toZ - fromZ;
      var mesh = box(Math.sqrt(dx * dx + dz * dz), SCENE.linkH, SCENE.linkD, colors.route);
      mesh.position.set((fromX + toX) / 2, 0, (fromZ + toZ) / 2);
      mesh.rotation.y = Math.atan2(-dz, dx); /* long axis along the gap */
      group.add(mesh);
    }

    /** Place the steps of one lane/list: a node connects from ALL of the
     *  previous step's end positions (a fork's single CSS link therefore
     *  becomes one thin diagonal per lane). Returns the end x + the z of
     *  every end node. */
    function placeSteps(steps, startX, z, prevX, prevZs) {
      var x = startX;
      var endX = x;
      var endZs = [];
      for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        if (step.kind === 'node') {
          if (prevX !== null) {
            for (var j = 0; j < prevZs.length; j++) addLink(prevX, prevZs[j], x, z);
          }
          addNode(step.type || 'route', x, z);
          prevX = x;
          prevZs = [z];
          endX = x;
          endZs = [z];
        } else if (step.kind === 'link') {
          x += SCENE.pitch;
        } else if (step.kind === 'fork') {
          endX = x;
          endZs = [];
          for (var li = 0; li < step.lanes.length; li++) {
            var laneZ = z + (li - (step.lanes.length - 1) / 2) * 2 * SCENE.laneZ;
            var r = placeSteps(step.lanes[li], x, laneZ, prevX, prevZs);
            if (r.endX > endX) endX = r.endX;
            for (var k = 0; k < r.endZs.length; k++) endZs.push(r.endZs[k]);
          }
          x = endX;
          prevX = endX;
          prevZs = endZs;
        }
      }
      return { endX: endX, endZs: endZs };
    }

    placeSteps(HERO_PATH, 0, 0, null, []);

    return {
      pose: function pose(t) {
        group.rotation.y = Math.sin(t * YAW_SPEED) * YAW_MAX; /* the slow yaw drift */
      },
      refit: applyFit /* the foundation's (re)fit hook — the aspect-derived fov */
    };
  }

  var ROGUE;
  var site;

  /** Mount (or re-mount, after a version-toggle re-render) the 3D hero
   *  scene in the .hero-stage. ROGUE3D.dispose() is the explicit boundary
   *  (a re-render replaced main's DOM — the old stage is gone); the
   *  foundation's shared renderer is reused (one WebGL context per page
   *  lifetime). On every failure path the pure-CSS fallback layer simply
   *  stays. */
  function mountHeroScene() {
    var main = document.querySelector('main');
    var stage = main ? main.querySelector('.hero .hero-stage') : null;
    if (!stage || !window.ROGUE3D) return;
    window.ROGUE3D.dispose();
    window.ROGUE3D.load().then(function (ok) {
      /* a later re-render may have superseded this one (a fast toggle) —
       * mount only if this stage still lives in the document */
      if (!ok || !stage.isConnected) return;
      window.ROGUE3D.mount(stage, {
        tokens: HERO_SCENE_TOKENS,
        build: function (THREE, scene, camera, colors) {
          return buildHeroScene(THREE, scene, camera, colors, stage);
        }
      });
    });
  }

  function render() {
    /* Hero: eyebrow / title / subtitle → run-path stage → stat blocks. */
    var hero = site.hero || {};
    var html = '<section class="section hero">';
    html += '<div class="section__head">';
    if (hero.eyebrow) html += '<p class="eyebrow">' + ROGUE.esc(hero.eyebrow) + '</p>';
    html += '<h1>' + ROGUE.esc(hero.title || '') + '</h1>';
    if (hero.subtitle) html += '<p class="hero__subtitle">' + ROGUE.esc(hero.subtitle) + '</p>';
    html += '</div>';
    /* The fixed-height stage: the binding pure-CSS path (the no-JS /
     * no-WebGL fallback layer) plus — when WebGL is available — the 3D
     * canvas the foundation appends over it (DESIGN.md §7). */
    html += '<div class="hero-stage">';
    html += runPathMarkup();
    html += '</div>';
    if (Array.isArray(hero.stats) && hero.stats.length) {
      html +=
        '<ul class="hero__stats">' +
        hero.stats
          .map(function (s) {
            return (
              '<li class="hero__stat">' +
              '<span class="hero__stat-value">' + ROGUE.esc(s.value) + '</span>' +
              '<span class="hero__stat-label">' + ROGUE.esc(s.label) + '</span>' +
              '</li>'
            );
          })
          .join('') +
        '</ul>';
    }
    html += '</section>';

    /* Quick-link cards for every other nav page. */
    var active = document.body.getAttribute('data-page') || '';
    var pages = site.pages || {};
    var links = (site.nav || []).filter(function (id) {
      return id !== active && pages[id];
    });
    if (links.length) {
      html +=
        '<section class="section"><div class="section__head"><h2>' +
        ROGUE.esc((site.quickLinks || {}).heading || 'Explore the docs') +
        '</h2></div>';
      html +=
        '<div class="grid">' +
        links
          .map(function (id) {
            var p = pages[id];
            return (
              '<a class="card card--link" href="./' + ROGUE.esc(id) + '.html">' +
              '<h3 class="card__title">' + ROGUE.esc(p.title) + '</h3>' +
              '<p class="card__desc">' + ROGUE.esc(p.description || '') + '</p>' +
              '</a>'
            );
          })
          .join('') +
        '</div></section>';
    }

    /* "About these docs" prose (data/site.json). */
    html += ROGUE.proseSections(site.prose);

    var main = document.querySelector('main');
    if (main) main.innerHTML = html;

    /* The 3D hero (deferred — the vendored three.js loads only through
     * ROGUE3D.load() after first paint; never in static markup). */
    mountHeroScene();
  }

  ROGUE = window.ROGUE;
  ROGUE.ready(function () {
    try {
      site = ROGUE.site();
    } catch (e) {
      window.console.error(e);
      return;
    }
    render();
    /* The version toggle re-renders main (like the other data pages): the
     * re-render disposes the live 3D mount and re-mounts it through the
     * foundation's shared renderer. */
    ROGUE.onChange(render);
  });
})();
