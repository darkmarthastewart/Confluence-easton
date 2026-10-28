/*!
 * Ballpoint: the cursor (or a finger) leaves a fading trail of scribbled ink. Dark Martha Stewart.
 * Never blocks clicks, taps or scrolling; stays still for people who ask for reduced motion.
 */
(function () {
  "use strict";
  if (window.Ballpoint) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var LIFE = 1100;        // how long ink stays, in ms
  var CURL_EVERY = 140;   // pixels of travel between little curls
  var cv, ctx, W = 0, H = 0, DPR = 1, pts = [], last = null, travel = 0, running = false, seed = 7;

  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

  function setup() {
    cv = document.createElement("canvas");
    cv.setAttribute("aria-hidden", "true");
    // orange-red ink (#FF4500) shows on both the white pages and the black footer
    cv.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646";
    document.body.appendChild(cv);
    ctx = cv.getContext("2d");
    size();
    window.addEventListener("resize", size);
    // mouse and pen through pointer events; fingers through touch events, which keep firing while the page scrolls
    window.addEventListener("pointermove", function (e) { if (e.pointerType !== "touch") onMove(e.clientX, e.clientY); }, { passive: true });
    window.addEventListener("touchstart", function (e) { lift(); onTouch(e); }, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
    window.addEventListener("touchend", lift, { passive: true });
    window.addEventListener("touchcancel", lift, { passive: true });
    document.addEventListener("mouseleave", lift);
  }
  function size() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  function lift() { last = null; if (pts.length) pts.push(null); }

  function add(x, y, t) { pts.push({ x: x, y: y, t: t }); }

  function onTouch(e) { var p = e.touches && e.touches[0]; if (p) onMove(p.clientX, p.clientY); }
  function onMove(x, y) {
    var t = performance.now();
    if (last) {
      var dx = x - last.x, dy = y - last.y, d = Math.hypot(dx, dy);
      if (d < 2) return;
      travel += d;
      // now and then the pen loops back on itself, like a doodler's scribble
      if (travel > CURL_EVERY && d > 3) {
        travel = 0;
        var r = 5 + rnd() * 7, dir = rnd() < 0.5 ? 1 : -1, ang = Math.atan2(dy, dx);
        var cx = x - Math.sin(ang) * r * dir, cy = y + Math.cos(ang) * r * dir;
        for (var k = 1; k <= 10; k++) {
          var a = ang - dir * Math.PI / 2 + dir * k * (Math.PI * 2 / 10);
          add(cx + Math.cos(a) * r, cy + Math.sin(a) * r, t);
        }
      }
    } else if (pts.length && pts[pts.length - 1] !== null) {
      pts.push(null);
    }
    add(x, y, t);
    last = { x: x, y: y };
    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  function frame(now) {
    // forget ink that has faded
    while (pts.length && (pts[0] === null || now - pts[0].t > LIFE)) pts.shift();
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "#FF4500";
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      if (!a || !b) continue;
      var age = (now - b.t) / LIFE;
      if (age >= 1) continue;
      var speed = Math.hypot(b.x - a.x, b.y - a.y);
      ctx.globalAlpha = Math.pow(1 - age, 1.4) * 0.9;
      ctx.lineWidth = Math.max(1.4, 3 - speed * 0.04);   // fast strokes run thinner, like a real pen
      // a smooth curve from the middle of one step to the middle of the next, bending through the point between
      var p = pts[i - 2], c = pts[i + 1];
      ctx.beginPath();
      if (p) ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2); else ctx.moveTo(a.x, a.y);
      if (c) ctx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
      else ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (pts.length) requestAnimationFrame(frame); else running = false;
  }

  window.Ballpoint = { on: true };
  if (document.body) setup(); else document.addEventListener("DOMContentLoaded", setup);
})();
