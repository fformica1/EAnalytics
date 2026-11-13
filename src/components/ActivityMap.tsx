import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { LocateFixed } from 'lucide-react';
import type { SportType, StreamPoint } from '../types/fitness';
import { isRunningLike } from '../utils/formatters';
import { useIsLightTheme } from '../utils/theme';

type ColorMode = 'speed' | 'hr' | 'ele' | 'grade';

interface ActivityMapProps {
  streams: StreamPoint[];
  sport: SportType;
  hoverIndex: number | null;
  highlightRange?: [number, number] | null; // [startSec, endSec]
  heroSheet?: boolean;
}

function interpolateColor(ratio: number, stops: [number, string][]): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (clamped >= t0 && clamped <= t1) {
      const local = (clamped - t0) / (t1 - t0 || 1);
      const r0 = parseInt(c0.slice(1, 3), 16);
      const g0 = parseInt(c0.slice(3, 5), 16);
      const b0 = parseInt(c0.slice(5, 7), 16);
      const r1 = parseInt(c1.slice(1, 3), 16);
      const g1 = parseInt(c1.slice(3, 5), 16);
      const b1 = parseInt(c1.slice(5, 7), 16);
      const r = Math.round(r0 + (r1 - r0) * local);
      const g = Math.round(g0 + (g1 - g0) * local);
      const b = Math.round(b0 + (b1 - b0) * local);
      return `rgb(${r},${g},${b})`;
    }
  }
  return stops[stops.length - 1][1];
}

const SPEED_STOPS: [number, string][] = [
  [0, '#38bdf8'],
  [0.45, '#10b981'],
  [0.75, '#f59e0b'],
  [1, '#ef4444'],
];

const HR_STOPS: [number, string][] = [
  [0, '#94a3b8'],
  [0.35, '#38bdf8'],
  [0.6, '#10b981'],
  [0.8, '#f59e0b'],
  [1, '#ef4444'],
];

const GRADE_STOPS: [number, string][] = [
  [0, '#38bdf8'],
  [0.4, '#10b981'],
  [0.65, '#f59e0b'],
  [0.85, '#ef4444'],
  [1, '#a855f7'],
];

interface ColoredNode {
  lat: number;
  lon: number;
  t: number;
  color: string;
}

/**
 * Custom single-canvas Leaflet overlay that draws a continuous, seamless
 * gradient GPS line with zero segmented breaks or overlapping caps.
 */
class ContinuousGradientLayer extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private nodes: ColoredNode[] = [];
  private highlightRange: [number, number] | null = null;
  private isLight = false;
  private drawnZoom = 0;
  private drawnTopLeft: L.LatLng | null = null;

  constructor(nodes: ColoredNode[], highlightRange: [number, number] | null, isLight: boolean) {
    super();
    this.nodes = nodes;
    this.highlightRange = highlightRange;
    this.isLight = isLight;
  }

  setData(nodes: ColoredNode[], highlightRange: [number, number] | null, isLight: boolean) {
    this.nodes = nodes;
    this.highlightRange = highlightRange;
    this.isLight = isLight;
    this.redraw();
  }

  onAdd(map: L.Map): this {
    const canvas = document.createElement('canvas');
    canvas.className = 'leaflet-zoom-animated';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    this.canvas = canvas;

    map.getPanes().overlayPane.appendChild(canvas);
    map.on('move viewreset resize zoomend', this.redraw, this);
    if (map.options.zoomAnimation) {
      map.on('zoomanim', this.onZoomAnim, this);
    }
    this.redraw();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off('move viewreset resize zoomend', this.redraw, this);
    map.off('zoomanim', this.onZoomAnim, this);
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    return this;
  }

  private onZoomAnim = (e: L.ZoomAnimEvent) => {
    const map = this._map as
      | (L.Map & {
          _latLngToNewLayerPoint?: (ll: L.LatLng, z: number, c: L.LatLng) => L.Point;
        })
      | null;
    const canvas = this.canvas;
    if (!map || !canvas || !this.drawnTopLeft || !map._latLngToNewLayerPoint) return;

    const scale = map.getZoomScale(e.zoom, this.drawnZoom);
    const offset = map._latLngToNewLayerPoint(this.drawnTopLeft, e.zoom, e.center);
    L.DomUtil.setTransform(canvas, offset, scale);
  };

  private redraw = () => {
    const map = this._map;
    const canvas = this.canvas;
    if (!map || !canvas) return;

    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    this.drawnZoom = map.getZoom();
    this.drawnTopLeft = map.containerPointToLatLng([0, 0]);
    L.DomUtil.setTransform(canvas, topLeft, 1);

    canvas.width = Math.max(1, Math.round(size.x * dpr));
    canvas.height = Math.max(1, Math.round(size.y * dpr));
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx || this.nodes.length < 2) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);

    const pts = this.nodes.map((n) => {
      const pt = map.latLngToContainerPoint([n.lat, n.lon]);
      return { x: pt.x, y: pt.y, t: n.t, color: n.color };
    });

    // 1. Single continuous outer casing for high contrast on cartoon light/dark map
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.strokeStyle = this.isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(10, 15, 25, 0.75)';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    // 2. Continuous point-to-point linear gradients (no breaks or seams)
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4.5;

    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      if (Math.abs(p1.x - p0.x) < 0.15 && Math.abs(p1.y - p0.y) < 0.15) {
        continue;
      }

      const inRange =
        !this.highlightRange ||
        (p0.t >= this.highlightRange[0] && p0.t <= this.highlightRange[1]);

      ctx.globalAlpha = inRange ? 0.98 : 0.25;

      const grad = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
      grad.addColorStop(0, p0.color);
      grad.addColorStop(1, p1.color);

      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.strokeStyle = grad;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
}

export function ActivityMap({
  streams,
  sport,
  hoverIndex,
  highlightRange,
  heroSheet = false,
}: ActivityMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const gradientLayerRef = useRef<ContinuousGradientLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const hoverMarkerRef = useRef<L.CircleMarker | null>(null);
  const isLight = useIsLightTheme();

  const [colorMode, setColorMode] = useState<ColorMode>('speed');

  const gpsPoints = useMemo(() => {
    const raw = streams.filter((p) => p.lat !== undefined && p.lon !== undefined);
    if (raw.length <= 650) return raw;
    const step = raw.length / 650;
    const out: StreamPoint[] = [];
    for (let i = 0; i < 650; i++) {
      out.push(raw[Math.min(raw.length - 1, Math.floor(i * step))]);
    }
    if (out[out.length - 1] !== raw[raw.length - 1]) {
      out.push(raw[raw.length - 1]);
    }
    return out;
  }, [streams]);

  const hasGps = gpsPoints.length >= 2;

  const coloredNodes = useMemo<ColoredNode[]>(() => {
    if (!hasGps) return [];

    const rawValues = gpsPoints.map((p) => {
      if (colorMode === 'hr') return p.hr ?? 0;
      if (colorMode === 'ele') return p.ele ?? 0;
      if (colorMode === 'grade') return p.grade ?? 0;
      return p.spd ?? 0;
    });

    // Smooth values with a 5-point moving average so colors flow organically
    const smoothed = rawValues.map((_, i) => {
      let sum = 0;
      let cnt = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(rawValues.length - 1, i + 2); k++) {
        sum += rawValues[k];
        cnt++;
      }
      return sum / cnt;
    });

    const validVals = smoothed.filter((v) => Number.isFinite(v));
    const minVal = colorMode === 'grade' ? -5 : Math.min(...validVals);
    const maxVal = colorMode === 'grade' ? 11 : Math.max(...validVals);
    const span = maxVal - minVal || 1;
    const stops =
      colorMode === 'hr' ? HR_STOPS : colorMode === 'grade' ? GRADE_STOPS : SPEED_STOPS;

    return gpsPoints.map((p, i) => ({
      lat: p.lat!,
      lon: p.lon!,
      t: p.t,
      color: interpolateColor((smoothed[i] - minVal) / span, stops),
    }));
  }, [gpsPoints, hasGps, colorMode]);

  useEffect(() => {
    if (!hasGps || !containerRef.current || mapRef.current) return;

    const initialCenter = gpsPoints[0]
      ? ([gpsPoints[0].lat, gpsPoints[0].lon] as [number, number])
      : ([45.4642, 9.19] as [number, number]);

    const map = L.map(containerRef.current, {
      center: initialCenter,
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
      doubleClickZoom: true,
    });
    mapRef.current = map;

    // Cartoon OpenStreetMap (lush greens, vivid azure sea, themed via CSS)
    const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    const gradLayer = new ContinuousGradientLayer([], null, isLight);
    gradLayer.addTo(map);
    gradientLayerRef.current = gradLayer;
    markersLayerRef.current = L.layerGroup().addTo(map);

    const t = setTimeout(() => map.invalidateSize(), 100);

    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      gradientLayerRef.current = null;
      markersLayerRef.current = null;
      hoverMarkerRef.current = null;
    };
  }, [hasGps]);

  // Double-tap and drag zoom gesture (one-finger zoom)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let lastTapTime = 0;
    let isDoubleTapDrag = false;
    let startY = 0;
    let startZoom = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        isDoubleTapDrag = false;
        return;
      }
      const now = Date.now();
      const timeDiff = now - lastTapTime;
      const touch = e.touches[0];

      if (timeDiff > 0 && timeDiff < 320) {
        isDoubleTapDrag = true;
        startY = touch.clientY;
        const map = mapRef.current;
        startZoom = map ? map.getZoom() : 13;
        e.preventDefault();
      } else {
        isDoubleTapDrag = false;
      }
      lastTapTime = now;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDoubleTapDrag || e.touches.length !== 1) return;
      const map = mapRef.current;
      if (!map) return;

      e.preventDefault();
      const currentY = e.touches[0].clientY;
      const diffY = currentY - startY;
      const zoomChange = diffY / 85;
      const targetZoom = Math.max(
        map.getMinZoom(),
        Math.min(map.getMaxZoom(), startZoom + zoomChange)
      );
      map.setZoom(targetZoom, { animate: false });
    };

    const onTouchEnd = () => {
      if (isDoubleTapDrag) {
        isDoubleTapDrag = false;
        const map = mapRef.current;
        if (map) {
          map.setZoom(Math.round(map.getZoom() * 2) / 2, { animate: true });
        }
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const gradLayer = gradientLayerRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !gradLayer || !markersLayer || !hasGps) return;

    gradLayer.setData(coloredNodes, highlightRange ?? null, isLight);
    markersLayer.clearLayers();

    const first = gpsPoints[0];
    const last = gpsPoints[gpsPoints.length - 1];
    L.circleMarker([first.lat!, first.lon!], {
      radius: 6,
      color: '#ffffff',
      weight: 2,
      fillColor: '#10b981',
      fillOpacity: 1,
    })
      .bindTooltip('Partenza')
      .addTo(markersLayer);

    L.circleMarker([last.lat!, last.lon!], {
      radius: 6,
      color: '#ffffff',
      weight: 2,
      fillColor: '#ef4444',
      fillOpacity: 1,
    })
      .bindTooltip('Arrivo')
      .addTo(markersLayer);

    const targetPoints = highlightRange
      ? gpsPoints.filter((p) => p.t >= highlightRange[0] && p.t <= highlightRange[1])
      : gpsPoints;
    const boundsPoints = targetPoints.length >= 2 ? targetPoints : gpsPoints;
    const bounds = L.latLngBounds(boundsPoints.map((p) => [p.lat!, p.lon!]));

    const isMobileHero = heroSheet && typeof window !== 'undefined' && window.innerWidth < 1024;
    const paddingBottom = isMobileHero ? Math.round(window.innerHeight * 0.58) : 28;
    const paddingTop = isMobileHero ? 60 : 28;
    map.invalidateSize();
    map.fitBounds(bounds, {
      paddingTopLeft: [24, paddingTop],
      paddingBottomRight: [24, paddingBottom],
    });
  }, [gpsPoints, hasGps, coloredNodes, highlightRange]);

  const recenterTrack = useCallback(() => {
    const map = mapRef.current;
    if (!map || gpsPoints.length < 2) return;

    const targetPoints = highlightRange
      ? gpsPoints.filter((p) => p.t >= highlightRange[0] && p.t <= highlightRange[1])
      : gpsPoints;
    const boundsPoints = targetPoints.length >= 2 ? targetPoints : gpsPoints;
    const bounds = L.latLngBounds(boundsPoints.map((p) => [p.lat!, p.lon!]));

    const isMobileHero = heroSheet && typeof window !== 'undefined' && window.innerWidth < 1024;
    const paddingBottom = isMobileHero ? Math.round(window.innerHeight * 0.58) : 28;
    const paddingTop = isMobileHero ? 60 : 28;

    map.invalidateSize();
    map.fitBounds(bounds, {
      paddingTopLeft: [24, paddingTop],
      paddingBottomRight: [24, paddingBottom],
      animate: true,
    });
  }, [gpsPoints, highlightRange, heroSheet]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (hoverIndex === null || !streams[hoverIndex]) {
      if (hoverMarkerRef.current) {
        map.removeLayer(hoverMarkerRef.current);
        hoverMarkerRef.current = null;
      }
      return;
    }

    const pt = streams[hoverIndex];
    if (pt.lat === undefined || pt.lon === undefined) return;

    if (!hoverMarkerRef.current) {
      hoverMarkerRef.current = L.circleMarker([pt.lat, pt.lon], {
        radius: 7,
        color: '#ffffff',
        weight: 2.5,
        fillColor: '#007CC3',
        fillOpacity: 1,
      }).addTo(map);
    } else {
      hoverMarkerRef.current.setLatLng([pt.lat, pt.lon]);
    }
  }, [hoverIndex, streams]);

  if (!hasGps) {
    return (
      <div
        className={`flex items-center justify-center bg-[#181A1D] text-sm text-[#8E9299] ${
          heroSheet
            ? 'h-48 pb-6 sm:rounded-t-2xl'
            : 'h-64 border-y border-white/[0.08] sm:rounded-2xl sm:border'
        }`}
      >
        Nessuna traccia GPS disponibile per questa attività
      </div>
    );
  }

  const cfgColor = (m: ColorMode) => {
    if (m === 'speed') return isRunningLike(sport) ? 'Passo' : 'Vel';
    if (m === 'hr') return 'FC';
    if (m === 'ele') return 'Alt';
    return 'Pend%';
  };

  return (
    <div
      className={`relative overflow-hidden bg-[#181A1D] ${
        heroSheet
          ? 'h-full w-full sm:h-[460px] sm:rounded-t-2xl lg:h-full lg:max-h-none lg:min-h-[380px] lg:rounded-xl lg:border lg:border-white/[0.08]'
          : 'h-72 border-y border-white/[0.08] shadow-xl sm:h-[380px] sm:rounded-xl sm:border'
      }`}
    >
      <div ref={containerRef} className="z-0 h-full w-full" />

      {/* Track Color Mode Selector */}
      <div className="pointer-events-auto absolute right-3 top-3 z-[400] flex items-center rounded-xl border border-white/10 bg-[#121212]/90 p-1 backdrop-blur-md">
        {(['speed', 'hr', 'ele', 'grade'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setColorMode(m)}
            className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
              colorMode === m
                ? 'bg-[#007CC3] text-white shadow-sm'
                : 'text-[#D4D6D9] hover:bg-white/10'
            }`}
          >
            {cfgColor(m)}
          </button>
        ))}
      </div>

      {/* Re-center GPS Track Button */}
      <button
        onClick={recenterTrack}
        aria-label="Riposiziona traccia GPS"
        title="Riposiziona sulla traccia GPS predefinita"
        className="pointer-events-auto absolute right-3 top-14 z-[400] flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-[#121212]/90 text-white shadow-lg backdrop-blur-md transition hover:bg-white/15 active:scale-95"
      >
        <LocateFixed className="h-4 w-4 text-[#38bdf8]" />
      </button>

      {/* Bottom color legend */}
      <div
        className={`pointer-events-none absolute left-3 z-[400] flex items-center gap-2 rounded-xl border border-white/10 bg-[#121212]/85 px-2.5 py-1 text-[10px] text-[#D4D6D9] backdrop-blur-md ${
          heroSheet ? 'bottom-[58dvh] sm:bottom-3' : 'bottom-3'
        }`}
      >
        <span>Basso</span>
        <div
          className="h-2 w-20 rounded-full"
          style={{
            background: 'linear-gradient(90deg, #38bdf8 0%, #10b981 40%, #f59e0b 75%, #ef4444 100%)',
          }}
        />
        <span>Alto</span>
      </div>
    </div>
  );
}
