/* Kinetic Hook engine.
 * Reads window.HOOK = { tokens, data } (written by scripts/build.mjs), lays the sentence out as stacked
 * lines that each fill the width, then builds ONE paused GSAP timeline and registers it.
 * Deterministic: no clocks and no unseeded randomness. The film grain uses a fixed seed.
 * Every size, colour, duration and ease comes from tokens.json; this file only holds roles.
 */
(function () {
  'use strict';
  var H = window.HOOK;
  var TK = H.tokens, D = H.data;
  var C = TK.color, M = TK.motion, TY = TK.type, FR = TK.frame, LY = TK.layout, SP = TK.space;
  var BOX = { x: LY.left, y: LY.top, w: FR.width - LY.left - LY.right, h: FR.height - LY.top - LY.bottom };
  var cam = document.getElementById('cam');
  var hud = document.getElementById('hud');

  function px(v) { return v + 'px'; }
  function em(v) { return v + 'em'; }

  function make(tag, cls, parent, style) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (style) for (var k in style) n.style[k] = style[k];
    if (parent) parent.appendChild(n);
    return n;
  }

  function role(node, r) {
    node.style.fontFamily = '"' + r.family + '", sans-serif';
    node.style.fontWeight = r.weight;
    node.style.letterSpacing = r.tracking || 'normal';
    if (r.lineHeight) node.style.lineHeight = r.lineHeight;
  }

  function isUrl(t) { return /[.\/@]\w/.test(t); }
  // Display type keeps only ? and ! — full stops and commas look like noise at this size.
  function shown(w) { return (isUrl(w.t) ? w.t : w.t.toUpperCase()) + (w.p || '').replace(/[^?!]/g, ''); }

  function makeWord(w, parent) {
    var wrap = make('span', 'w', parent);
    var blk = null;
    if (w.emph) {
      blk = make('span', 'blk', wrap, {
        background: C.accent,
        left: em(SP.blockPadX), right: em(SP.blockPadX), top: em(SP.blockPadTop), bottom: em(SP.blockPadBottom),
      });
    }
    // key words start in ink and switch to accentInk only once their block is behind them
    var inner = make('span', 'wi', wrap, { color: C.ink });
    inner.textContent = shown(w);
    return { wrap: wrap, inner: inner, blk: blk, w: w };
  }

  // Size a line so it fills maxW, within [min, max]. Uses layout widths (not affected by transforms).
  function fitLine(line, maxW, max, min) {
    line.style.fontSize = '200px';
    var w = line.offsetWidth || 1;
    var size = Math.max(min, Math.min(max, maxW * 200 / w));
    line.style.fontSize = px(size);
    return size;
  }

  // ---------- layout ----------
  function layout(stageInner) {
    var block = make('div', 'stack', stageInner, { position: 'absolute', left: px(BOX.x), width: px(BOX.w) });
    role(block, TY.display);
    var refs = [], lines = [];
    D.lines.forEach(function (idxs) {
      var L = make('div', 'line', block);
      var lr = [];
      idxs.forEach(function (i, k) {
        if (k) L.appendChild(document.createTextNode(' '));
        var r = makeWord(D.words[i], L);
        refs.push(r); lr.push(r);
      });
      lines.push({ el: L, refs: lr });
    });
    var sizes = lines.map(function (l) { return fitLine(l.el, BOX.w, TY.display.max, TY.display.min); });
    var total = sizes.reduce(function (a, v) { return a + v * TY.display.lineHeight; }, 0);
    if (total > BOX.h) {
      var f = BOX.h / total;
      sizes = sizes.map(function (v, k) { lines[k].el.style.fontSize = px(v * f); return v * f; });
      total = BOX.h;
    }
    block.style.top = px(BOX.y + (BOX.h - total) / 2);
    return { refs: refs, lines: lines, block: block };
  }

  // ---------- grain (seeded, static) ----------
  function grain() {
    var c = document.getElementById('grain');
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(c.width, c.height);
    var seed = 20261117;
    function rnd() { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    for (var i = 0; i < img.data.length; i += 4) {
      var v = Math.round(rnd() * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    c.style.opacity = C.grain;
    c.style.mixBlendMode = 'overlay';
  }

  // ---------- build ----------
  function build() {
    var tl = gsap.timeline({ paused: true });
    grain();
    // cam = slow drift · stage = steady push-in · punch = short kick on key words
    var stage = make('div', 'layer', cam);
    var punch = make('div', 'layer', stage);
    var L = layout(punch);

    // drift: smooth, frame-derived wobble of the whole picture
    var dr = M.drift, o = { t: 0 }, dur = D.duration;
    tl.fromTo(o, { t: 0 }, {
      t: dur, duration: dur, ease: 'none',
      onUpdate: function () {
        var t = o.t, TAU = Math.PI * 2;
        gsap.set(cam, {
          x: dr.x * Math.sin(TAU * t / dr.periodX),
          y: dr.y * Math.sin(TAU * t / dr.periodY + 1.3),
          rotation: dr.rotate * Math.sin(TAU * t / dr.periodR + 0.6),
        });
      },
    }, 0);
    tl.fromTo(stage, { scale: 1 }, { scale: 1 + M.push, duration: dur, ease: 'none', transformOrigin: '50% 45%' }, 0);

    // words land one by one
    L.lines.forEach(function (line) {
      var first = line.refs[0].w.s;
      tl.fromTo(line.el, { scale: M.lineSettle.from }, { scale: 1, duration: M.lineSettle.duration, ease: M.lineSettle.ease, transformOrigin: '0% 50%' }, Math.max(0, first - M.wordIn.lead));
    });
    L.refs.forEach(function (r) {
      var at = Math.max(0, r.w.s - M.wordIn.lead);
      tl.fromTo(r.inner, { yPercent: M.wordIn.from }, { yPercent: 0, duration: M.wordIn.duration, ease: M.wordIn.ease }, at);
      if (r.w.emph) {
        var bAt = Math.max(0, r.w.s - M.block.lead);
        tl.fromTo(r.blk, { scaleX: 0 }, { scaleX: 1, duration: M.block.duration, ease: M.block.ease }, bAt);
        // colour flips in one frame as the glyphs start rising (no grey in-between)
        tl.fromTo(r.inner, { color: C.ink }, { color: C.accentInk, duration: 0.001, ease: 'none' }, at);
        tl.fromTo(r.wrap, { scale: M.emphPop.from }, { scale: 1, duration: M.emphPop.duration, ease: M.emphPop.ease }, at);
      }
    });

    // the whole frame kicks forward on each key word; a kick never overlaps the next one
    var kicks = L.refs.filter(function (r) { return r.w.emph; }).map(function (r) { return r.w.s; });
    kicks.forEach(function (t, k) {
      var next = k + 1 < kicks.length ? kicks[k + 1] : D.exitAt;
      var out = Math.max(0.05, Math.min(M.punch.out, next - t - M.punch.in));
      tl.fromTo(punch, { scale: 1 }, { scale: 1 + M.punch.scale, duration: M.punch.in, ease: M.punch.easeIn, transformOrigin: '50% 50%', immediateRender: false }, t);
      tl.to(punch, { scale: 1, duration: out, ease: M.punch.easeOut }, t + M.punch.in);
    });

    // exit: words leave upward through their masks, key-word blocks retract
    var X = M.exit;
    L.refs.forEach(function (r, k) {
      var at = D.exitAt + k * X.stagger;
      tl.fromTo(r.inner, { yPercent: 0 }, { yPercent: X.to, duration: X.duration, ease: X.ease, immediateRender: false }, at);
      if (r.blk) tl.fromTo(r.blk, { scaleX: 1 }, { scaleX: 0, duration: X.duration, ease: X.ease, transformOrigin: '100% 50%', immediateRender: false }, at);
    });

    // optional small label at the top
    if (D.label) {
      var lab = make('div', 'label', hud, { position: 'absolute', left: px(BOX.x), top: px(LY.labelTop), fontSize: px(TY.label.size), color: C.muted, textTransform: 'uppercase' });
      role(lab, TY.label);
      lab.textContent = D.label;
      tl.fromTo(lab, { opacity: 0 }, { opacity: 1, duration: M.labelIn.duration, ease: M.labelIn.ease }, 0);
      tl.to(lab, { opacity: 0, duration: X.duration, ease: X.ease }, D.exitAt);
    }

    window.__timelines = window.__timelines || {};
    window.__timelines['hook'] = tl;
  }

  Promise.all(['800 40px "Inter Tight"', '500 40px "JetBrains Mono"'].map(function (f) { return document.fonts.load(f); }))
    .then(function () { return document.fonts.ready; })
    .then(build);
})();
