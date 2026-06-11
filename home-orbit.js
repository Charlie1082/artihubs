(() => {
  const canvases = document.querySelectorAll(".home-orbit-canvas");
  if (!canvases.length) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const palettes = {
    cyan: [139, 224, 255],
    blue: [92, 160, 255],
    gold: [255, 200, 119],
  };

  const planes = [
    { rx: 1.18, ry: 0.34, tilt: -0.55, color: palettes.cyan, alpha: 0.22, speed: 0.18, size: 3.1, count: 3 },
    { rx: 1.28, ry: 0.43, tilt: 0.86, color: palettes.blue, alpha: 0.17, speed: 0.13, size: 2.5, count: 2 },
    { rx: 1.05, ry: 0.58, tilt: 0.18, color: palettes.gold, alpha: 0.13, speed: 0.09, size: 2.8, count: 2 },
  ];

  const rgba = ([r, g, b], alpha) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

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

  const drawOrbit = (ctx, cx, cy, rx, ry, tilt, color, alpha, width) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0.08 * Math.PI, 1.92 * Math.PI);
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.shadowColor = rgba(color, alpha * 0.75);
    ctx.shadowBlur = 4;
    ctx.stroke();
    ctx.restore();
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
      const fade = (1 - index / segments) * (front ? 1 : 0.36);

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
    const alpha = front ? 0.86 : 0.23;
    const scale = front ? 1 : 0.72;
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
    if (reducedMotion) return;

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

  const fitCanvas = (canvas) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    return { dpr, width: canvas.clientWidth, height: canvas.clientHeight };
  };

  const renderCanvas = (canvas, time) => {
    const ctx = canvas.getContext("2d");
    const { dpr, width, height } = fitCanvas(canvas);
    const cx = width * 0.58;
    const cy = height * 0.47;
    const r = Math.min(width, height) * (width < 520 ? 0.31 : 0.35);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";

    planes.forEach((plane, planeIndex) => {
      const rx = r * plane.rx;
      const ry = r * plane.ry;

      drawOrbit(ctx, cx, cy, rx, ry, plane.tilt, plane.color, plane.alpha, planeIndex === 0 ? 1.25 : 1.1);

      for (let index = 0; index < plane.count; index += 1) {
        const base = (index / plane.count) * Math.PI * 2 + planeIndex * 0.9;
        const direction = planeIndex % 2 ? -1 : 1;
        const angle = reducedMotion ? base + 0.55 : base + time * plane.speed * direction;
        const strong = planeIndex === 0 && index === 0;
        const point = pointOnOrbit(cx, cy, rx, ry, plane.tilt, angle);
        const pulse = strong && !reducedMotion ? (Math.sin(time * 1.2) + 1) / 2 : 0;

        if (!reducedMotion) {
          drawTrail(ctx, cx, cy, rx, ry, plane.tilt, angle, plane.color, strong);
        }

        drawSatellite(ctx, point, plane.color, plane.size, pulse);
      }
    });

    drawRareLimbPass(ctx, cx, cy, r, time);
    ctx.globalCompositeOperation = "source-over";
  };

  const renderAll = (now) => {
    const time = now / 1000;
    canvases.forEach((canvas) => renderCanvas(canvas, time));

    if (!reducedMotion) {
      window.requestAnimationFrame(renderAll);
    }
  };

  window.requestAnimationFrame(renderAll);
  window.addEventListener("resize", () => {
    if (reducedMotion) window.requestAnimationFrame(renderAll);
  });
})();
