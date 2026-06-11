(() => {
  const canvases = [...document.querySelectorAll(".home-orbit-canvas")];
  if (!canvases.length) return;

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const palettes = {
    cyan: [139, 224, 255],
    blue: [92, 160, 255],
    gold: [255, 200, 119],
  };

  const planes = [
    { name: "draft1-primary", rx: 1.18, ry: 0.34, tilt: -0.55, color: palettes.cyan, alpha: 0.24, speed: 0.18, size: 3.1, count: 3 },
    { name: "draft4-cross", rx: 1.28, ry: 0.43, tilt: 0.86, color: palettes.blue, alpha: 0.18, speed: 0.13, size: 2.5, count: 2 },
    { name: "draft1-low", rx: 1.05, ry: 0.58, tilt: 0.18, color: palettes.gold, alpha: 0.14, speed: 0.09, size: 2.8, count: 2 },
  ];

  const planeRatios = planes.map(({ name, rx, ry, tilt }) => ({ name, rx, ry, tilt }));
  const rgba = ([r, g, b], alpha) => `rgba(${r}, ${g}, ${b}, ${alpha})`;
  const finite = (value) => Number.isFinite(value) && value > 0;

  const pointOnOrbit = (cx, cy, rx, ry, tilt, angle) => {
    const x = Math.cos(angle) * rx;
    const y = Math.sin(angle) * ry;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);

    return {
      x: cx + x * cos - y * sin,
      y: cy + x * sin + y * cos,
      z: Math.sin(angle),
    };
  };

  const rectFromSvgCircle = (iframe, svg, circle) => {
    const iframeRect = iframe.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox && svg.viewBox.baseVal;
    const cx = circle.cx && circle.cx.baseVal && circle.cx.baseVal.value;
    const cy = circle.cy && circle.cy.baseVal && circle.cy.baseVal.value;
    const r = circle.r && circle.r.baseVal && circle.r.baseVal.value;

    if (!viewBox || !finite(svgRect.width) || !finite(svgRect.height) || !finite(r)) {
      return null;
    }

    const scaleX = svgRect.width / viewBox.width;
    const scaleY = svgRect.height / viewBox.height;
    const scale = Math.min(scaleX, scaleY);

    return {
      left: iframeRect.left + svgRect.left + (cx - viewBox.x) * scaleX - r * scale,
      top: iframeRect.top + svgRect.top + (cy - viewBox.y) * scaleY - r * scale,
      width: r * 2 * scale,
      height: r * 2 * scale,
    };
  };

  const measureIframeSphere = (globe, orbitRect) => {
    const iframe = globe && globe.querySelector(".home-globe-frame");
    if (!iframe || !iframe.contentDocument) return null;

    const doc = iframe.contentDocument;
    const svg = doc.querySelector("#globe-svg");
    const circle = doc.querySelector("#globe-svg .rim, #globe-svg .ocean, #sphere-clip circle");
    if (!svg || !circle) return null;

    const sphereRect = rectFromSvgCircle(iframe, svg, circle);
    if (!sphereRect || !finite(sphereRect.width) || !finite(sphereRect.height)) return null;

    return {
      source: "iframe-sphere",
      cx: sphereRect.left + sphereRect.width / 2 - orbitRect.left,
      cy: sphereRect.top + sphereRect.height / 2 - orbitRect.top,
      r: Math.min(sphereRect.width, sphereRect.height) / 2,
      sphereRect,
    };
  };

  const measureFallbackSphere = (globe, orbitRect) => {
    const fallback = globe && globe.querySelector(".home-globe-fallback");
    const rect = fallback && fallback.getBoundingClientRect();
    if (!rect || !finite(rect.width) || !finite(rect.height)) return null;

    return {
      source: "fallback-sphere",
      cx: rect.left + rect.width / 2 - orbitRect.left,
      cy: rect.top + rect.height / 2 - orbitRect.top,
      r: Math.min(rect.width, rect.height) / 2,
      sphereRect: rect,
    };
  };

  const measureHomeGlobe = (globe, orbitRect) => {
    const rect = globe && globe.getBoundingClientRect();
    if (!rect || !finite(rect.width) || !finite(rect.height)) return null;

    return {
      source: "home-globe-estimate",
      cx: rect.left + rect.width / 2 - orbitRect.left,
      cy: rect.top + rect.height / 2 - orbitRect.top,
      r: Math.min(rect.width, rect.height) * 0.42,
      sphereRect: rect,
    };
  };

  const measureSphere = (canvas) => {
    const orbit = canvas.closest(".home-orbit");
    const globe = canvas.closest(".home-globe");
    const orbitRect = orbit && orbit.getBoundingClientRect();
    if (!orbitRect || !finite(orbitRect.width) || !finite(orbitRect.height)) return null;

    return (
      measureIframeSphere(globe, orbitRect) ||
      measureFallbackSphere(globe, orbitRect) ||
      measureHomeGlobe(globe, orbitRect)
    );
  };

  const fitCanvas = (canvas) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    return { dpr, width: rect.width, height: rect.height };
  };

  const drawOrbit = (ctx, cx, cy, rx, ry, tilt, color, alpha, width, planeIndex, time) => {
    const segments = 216;
    const period = planeIndex === 0 ? 0.42 : 0.5;
    const visible = planeIndex === 0 ? 0.29 : 0.27;
    const phase = time * 0.016 * (planeIndex % 2 ? -1 : 1) + planeIndex * 0.37;

    for (let index = 0; index < segments; index += 1) {
      const a1 = (index / segments) * Math.PI * 2;
      const a2 = ((index + 0.82) / segments) * Math.PI * 2;
      const mid = (a1 + a2) / 2;
      const dash = (mid + phase + Math.PI * 12) % period;
      const front = Math.sin(mid) > -0.16;
      const nearLimb = Math.abs(Math.sin(mid)) < 0.24;

      if (dash > visible && !nearLimb) continue;

      const p1 = pointOnOrbit(cx, cy, rx, ry, tilt, a1);
      const p2 = pointOnOrbit(cx, cy, rx, ry, tilt, a2);
      const alphaScale = front ? 1 : 0.18;

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = rgba(color, alpha * alphaScale);
      ctx.lineWidth = front ? width : width * 0.72;
      ctx.lineCap = "round";
      ctx.shadowColor = rgba(color, alpha * alphaScale * 0.7);
      ctx.shadowBlur = front ? 3 : 1;
      ctx.stroke();
    }
  };

  const drawTrail = (ctx, cx, cy, rx, ry, tilt, angle, color, strong) => {
    const length = strong ? 0.34 : 0.22;
    const segments = 14;

    for (let index = 0; index < segments; index += 1) {
      const a1 = angle - (index / segments) * length;
      const a2 = angle - ((index + 0.72) / segments) * length;
      const p1 = pointOnOrbit(cx, cy, rx, ry, tilt, a1);
      const p2 = pointOnOrbit(cx, cy, rx, ry, tilt, a2);
      const front = (p1.z + p2.z) / 2 > -0.12;
      const fade = (1 - index / segments) * (front ? 1 : 0.28);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = rgba(color, fade * (strong ? 0.36 : 0.22));
      ctx.lineWidth = strong ? 2.2 : 1.35;
      ctx.lineCap = "round";
      ctx.stroke();
    }
  };

  const drawSatellite = (ctx, point, color, size, pulse = 0) => {
    const front = point.z > -0.12;
    const alpha = front ? 0.86 : 0.2;
    const scale = front ? 1 : 0.68;
    const radius = size * scale + pulse * 1.2;
    const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 5.5);

    glow.addColorStop(0, rgba(color, alpha));
    glow.addColorStop(0.38, rgba(color, alpha * 0.34));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawRareLimbPass = (ctx, cx, cy, r, time) => {
    if (motionQuery.matches) return;

    const phase = (time % 21) / 21;
    if (phase < 0.62 || phase > 0.8) return;

    const progress = (phase - 0.62) / 0.18;
    const ease = Math.sin(progress * Math.PI);
    const rx = r * 1.16;
    const ry = r * 0.33;
    const tilt = -0.42;
    const angle = -1.75 + progress * 2.45;
    const point = pointOnOrbit(cx, cy, rx, ry, tilt, angle);

    ctx.globalAlpha = ease;
    drawTrail(ctx, cx, cy, rx, ry, tilt, angle, palettes.gold, true);
    drawSatellite(ctx, point, palettes.gold, 4.6, ease * 1.6);
    ctx.globalAlpha = 1;
  };

  const publishGeometry = (canvas, geometry, width, height) => {
    const payload = {
      source: geometry.source,
      cx: Number(geometry.cx.toFixed(2)),
      cy: Number(geometry.cy.toFixed(2)),
      r: Number(geometry.r.toFixed(2)),
      width: Number(width.toFixed(2)),
      height: Number(height.toFixed(2)),
      viewport: `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`,
      planeRatios,
    };

    canvas.dataset.homeOrbitGeometrySource = payload.source;
    canvas.dataset.homeOrbitCx = String(payload.cx);
    canvas.dataset.homeOrbitCy = String(payload.cy);
    canvas.dataset.homeOrbitR = String(payload.r);
    canvas.dataset.homeOrbitPlaneRatios = JSON.stringify(planeRatios);
    canvas.__homeOrbitGeometry = payload;
    window.__artihubsHomeOrbitGeometry = canvases.map((item) => item.__homeOrbitGeometry).filter(Boolean);
  };

  const renderCanvas = (canvas, now) => {
    const ctx = canvas.getContext("2d");
    const { dpr, width, height } = fitCanvas(canvas);
    const geometry = measureSphere(canvas);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!geometry || !finite(geometry.r)) {
      canvas.dataset.homeOrbitGeometrySource = "unavailable";
      return;
    }

    const time = now / 1000;
    const { cx, cy, r } = geometry;
    publishGeometry(canvas, geometry, width, height);

    ctx.globalCompositeOperation = "lighter";
    planes.forEach((plane, planeIndex) => {
      const rx = r * plane.rx;
      const ry = r * plane.ry;

      drawOrbit(ctx, cx, cy, rx, ry, plane.tilt, plane.color, plane.alpha, planeIndex === 0 ? 1.35 : 1.12, planeIndex, time);

      for (let index = 0; index < plane.count; index += 1) {
        const base = (index / plane.count) * Math.PI * 2 + planeIndex * 0.9;
        const direction = planeIndex % 2 ? -1 : 1;
        const angle = motionQuery.matches ? base + 0.55 : base + time * plane.speed * direction;
        const strong = planeIndex === 0 && index === 0;
        const point = pointOnOrbit(cx, cy, rx, ry, plane.tilt, angle);
        const pulse = strong && !motionQuery.matches ? (Math.sin(time * 1.2) + 1) / 2 : 0;

        if (!motionQuery.matches) {
          drawTrail(ctx, cx, cy, rx, ry, plane.tilt, angle, plane.color, strong);
        }

        drawSatellite(ctx, point, plane.color, plane.size, pulse);
      }
    });

    drawRareLimbPass(ctx, cx, cy, r, time);
    ctx.globalCompositeOperation = "source-over";
  };

  const renderAll = (now) => {
    canvases.forEach((canvas) => renderCanvas(canvas, now));

    if (!motionQuery.matches) {
      window.requestAnimationFrame(renderAll);
    }
  };

  const requestRender = () => {
    window.requestAnimationFrame((now) => {
      canvases.forEach((canvas) => renderCanvas(canvas, now));
    });
  };

  const observeGeometrySources = () => {
    if (!("ResizeObserver" in window)) return;

    const observer = new ResizeObserver(requestRender);
    canvases.forEach((canvas) => {
      const orbit = canvas.closest(".home-orbit");
      const globe = canvas.closest(".home-globe");
      const iframe = globe && globe.querySelector(".home-globe-frame");

      if (orbit) observer.observe(orbit);
      if (globe) observer.observe(globe);
      if (iframe) {
        observer.observe(iframe);
        iframe.addEventListener("load", requestRender);
      }
    });
  };

  observeGeometrySources();
  window.requestAnimationFrame(renderAll);
  window.addEventListener("resize", requestRender);
  if (motionQuery.addEventListener) {
    motionQuery.addEventListener("change", requestRender);
  } else if (motionQuery.addListener) {
    motionQuery.addListener(requestRender);
  }
})();
