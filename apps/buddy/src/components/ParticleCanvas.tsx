/**
 * Particle canvas — every keypress spawns a small burst of particles at a
 * point on screen. Particles drift outward, fade, and die. Uses Canvas 2D
 * with additive blending for the "glow" look. Frame-rate is uncoupled from
 * the audio engine via requestAnimationFrame.
 */

import { useEffect, useRef } from 'react';
import { useBuddyStore } from '@/state/store';
import type { KeyboardEvent } from '@shared/types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface Ripple {
  x: number;
  y: number;
  startedAt: number;
  color: string;
}

export function ParticleCanvas(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const recentRef = useRef<KeyboardEvent[]>([]);
  const processedRef = useRef<Set<number>>(new Set());
  const lastFrameRef = useRef<number>(0);

  useEffect(() => {
    const unsub = useBuddyStore.subscribe((state) => {
      recentRef.current = state.recent as KeyboardEvent[];
    });
    recentRef.current = useBuddyStore.getState().recent as KeyboardEvent[];
    return unsub;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let raf = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const spawnFromEvent = (event: KeyboardEvent, accent: string) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const x = ((event.vk * 137) % w);
      const y = ((event.vk * 91 + event.scanCode * 31) % h);
      const count = 18;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        const speed = 1.2 + Math.random() * 2.6;
        particlesRef.current.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: 600 + Math.random() * 500,
          size: 1.4 + Math.random() * 2.2,
          color: accent,
        });
      }
      ripplesRef.current.push({ x, y, startedAt: performance.now(), color: accent });
      if (ripplesRef.current.length > 24) ripplesRef.current.shift();
    };

    const draw = (now: number) => {
      const dt = lastFrameRef.current === 0 ? 16 : now - lastFrameRef.current;
      lastFrameRef.current = now;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const state = useBuddyStore.getState();
      const density = 1;
      const paused = false;
      const themeId = state.themeId;

      if (!paused) {
        const accent = resolveAccent(themeId);

        const events = recentRef.current;
        for (let i = 0; i < events.length && i < 4; i++) {
          const ev = events[i];
          if (!ev) continue;
          const arrival = (ev as KeyboardEvent & { arrivalMs?: number }).arrivalMs;
          if (arrival === undefined) continue;
          if (processedRef.current.has(arrival)) continue;
          if (now - arrival < 80) {
            spawnFromEvent(ev, accent);
            processedRef.current.add(arrival);
          }
        }

        if (processedRef.current.size > 256) {
          const cutoff = now - 2000;
          for (const t of processedRef.current) {
            if (t < cutoff) processedRef.current.delete(t);
          }
        }

        for (let i = particlesRef.current.length - 1; i >= 0; i--) {
          const p = particlesRef.current[i];
          if (!p) continue;
          p.life += dt;
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.012 * dt;
          p.vx *= 0.992;
          p.vy *= 0.992;
          if (p.life >= p.maxLife) {
            particlesRef.current.splice(i, 1);
            continue;
          }
          const t = 1 - p.life / p.maxLife;
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = withAlpha(p.color, t * density);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }

        for (let i = ripplesRef.current.length - 1; i >= 0; i--) {
          const r = ripplesRef.current[i];
          if (!r) continue;
          const age = (now - r.startedAt) / 800;
          if (age >= 1) {
            ripplesRef.current.splice(i, 1);
            continue;
          }
          const radius = age * Math.max(w, h) * 0.4;
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = withAlpha(r.color, (1 - age) * 0.18 * density);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }
  return color;
}

function resolveAccent(themeId: 'minimal' | 'neon' | 'synthwave'): string {
  switch (themeId) {
    case 'minimal': return '#cfd2dc';
    case 'synthwave': return '#ff3df0';
    case 'neon':
    default: return '#5af2a0';
  }
}
