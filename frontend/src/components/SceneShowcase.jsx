// ---------------------------------------------------------------------------
// Shared "photoreal night highway" scene system.
//
// Originally built inline in Comparison.jsx for the conventional-vs-adaptive
// showcase; extracted here so any page can render the same backdrop, road
// perspective, object sprites and labeled boxes without duplicating the SVG.
// Comparison.jsx and Prediction.jsx both import from this file, which is
// what keeps their visuals identical.
// ---------------------------------------------------------------------------

// Shared perspective model. All overlay geometry is expressed in a 0..100
// viewBox and converges to a single vanishing point tuned to the road plate.
export const VP = { x: 48.8, y: 38.5 };   // vanishing point on the horizon
export const BL = { x: 12, y: 100 };      // road bottom-left
export const BR = { x: 90, y: 100 };      // road bottom-right
export const lerp = (a, b, t) => a + (b - a) * t;
// n+1 evenly spaced values from a..b (n cells). Higher n = finer resolution.
export const linspace = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
// A road-plane point at depth t (0 = near/bottom, 1 = far/horizon) and lateral
// position c (0 = left edge, 1 = right edge). Also the function any dynamic
// scene (like the Prediction page) should use to place objects consistently
// with the backdrop's perspective.
export function corner(t, c) {
  const bx = lerp(BL.x, BR.x, c);
  const by = lerp(BL.y, BR.y, c);
  return { x: lerp(bx, VP.x, t), y: lerp(by, VP.y, t) };
}

// Fills the quads between successive rows/cols with a single tinted color.
export function PerspectiveCells({ rows, cols, color, fillOpacity = 0.2, strokeOpacity = 0.55, strokeWidth = 0.16 }) {
  const quads = [];
  for (let i = 0; i < rows.length - 1; i += 1) {
    for (let j = 0; j < cols.length - 1; j += 1) {
      const p1 = corner(rows[i], cols[j]);
      const p2 = corner(rows[i], cols[j + 1]);
      const p3 = corner(rows[i + 1], cols[j + 1]);
      const p4 = corner(rows[i + 1], cols[j]);
      quads.push(`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`);
    }
  }
  return quads.map((points, k) => (
    <polygon fill={color} fillOpacity={fillOpacity} key={k} points={points} stroke={color} strokeOpacity={strokeOpacity} strokeWidth={strokeWidth} />
  ));
}

// Draws a rows x cols lattice of fine cells directly over an object's screen
// rectangle (all values in the shared 0..100 space). More rows/cols = higher
// allocated resolution.
export function ObjectCellGrid({ x, y, w, h, rows, cols, color, fillOpacity = 0.16, strokeOpacity = 0.9, strokeWidth = 0.16 }) {
  const cw = w / cols;
  const ch = h / rows;
  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      cells.push({ x: x + c * cw, y: y + r * ch });
    }
  }
  return cells.map((cell, i) => (
    <rect
      fill={color}
      fillOpacity={fillOpacity}
      height={ch}
      key={i}
      stroke={color}
      strokeOpacity={strokeOpacity}
      strokeWidth={strokeWidth}
      width={cw}
      x={cell.x}
      y={cell.y}
    />
  ));
}

// Self-contained night-highway backdrop, drawn entirely in SVG in the same
// 0..100 viewBox the overlays use (VP / BL / BR). No external image.
export function SceneBackdrop() {
  // center-line dashes marching toward the vanishing point
  const dashes = Array.from({ length: 8 }, (_, i) => {
    const t = i / 8;
    const p = corner(t, 0.5);
    const w = lerp(1.8, 0.15, t);
    const h = lerp(3.2, 0.3, t);
    return { x: p.x - w / 2, y: p.y - h, w, h, o: lerp(0.75, 0.15, t) };
  });

  const stars = [
    [14, 10], [22, 16], [33, 8], [41, 14], [58, 9],
    [67, 15], [78, 11], [86, 18], [50, 6], [30, 20], [72, 22],
  ];

  return (
    <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="sceneSky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#0a1022" />
          <stop offset="70%" stopColor="#131d38" />
          <stop offset="100%" stopColor="#0c1327" />
        </linearGradient>
        <linearGradient id="sceneGround" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#0a0f1e" />
          <stop offset="100%" stopColor="#05070f" />
        </linearGradient>
        <linearGradient id="sceneRoad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#161c2b" />
          <stop offset="100%" stopColor="#262c3c" />
        </linearGradient>
        <radialGradient id="sceneLamp" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sceneHead" cx="50%" cy="100%" r="75%">
          <stop offset="0%" stopColor="#cfe0ff" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#cfe0ff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* sky + ground split at the horizon (VP.y = 38.5) */}
      <rect fill="url(#sceneSky)" height="38.5" width="100" x="0" y="0" />
      <rect fill="url(#sceneGround)" height="61.5" width="100" x="0" y="38.5" />

      {/* stars */}
      {stars.map(([x, y], i) => (
        <circle cx={x} cy={y} fill="#e2e8f0" key={i} opacity={0.5} r={0.25} />
      ))}

      {/* distant tree line / hills silhouette along the horizon */}
      <path d="M0,38.5 Q10,33 20,37 T40,36 T60,37 T80,35 T100,38 L100,42 L0,42 Z" fill="#070b16" opacity="0.9" />

      {/* road surface converging to the vanishing point */}
      <polygon fill="url(#sceneRoad)" points="10,100 92,100 48.8,38.5" />

      {/* road edge lines */}
      <line opacity="0.55" stroke="#64748b" strokeWidth="0.35" x1="10" x2="48.8" y1="100" y2="38.5" />
      <line opacity="0.55" stroke="#64748b" strokeWidth="0.35" x1="92" x2="48.8" y1="100" y2="38.5" />

      {/* lane dividers */}
      <line opacity="0.18" stroke="#94a3b8" strokeWidth="0.2" x1="33" x2="48.8" y1="100" y2="38.5" />
      <line opacity="0.18" stroke="#94a3b8" strokeWidth="0.2" x1="69" x2="48.8" y1="100" y2="38.5" />

      {/* dashed center line */}
      {dashes.map((d, i) => (
        <rect fill="#e2e8f0" height={d.h} key={i} opacity={d.o} rx={0.1} width={d.w} x={d.x} y={d.y} />
      ))}

      {/* our own car's headlight wash at the bottom center */}
      <ellipse cx="51" cy="100" fill="url(#sceneHead)" rx="26" ry="34" />
    </svg>
  );
}

// Backdrop + overlay layer. Overlay geometry stays aligned to the road.
export function SceneMedia({ overlay, children }) {
  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-950">
      <SceneBackdrop />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/50 via-transparent to-slate-950/10" />
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
        {overlay}
      </svg>
      {children}
    </div>
  );
}

// A labeled bounding box positioned directly in container-percentage space.
// Optionally clickable/selectable so pages that need to inspect an object
// (e.g. Prediction's object selector) can reuse it as the hit target, layered
// on top of the decorative (pointer-events-none) sprite underneath.
export function SceneBox({ x, y, w, h, color, label, sub, onClick, selected }) {
  return (
    <div
      className={`absolute ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
      style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
    >
      <div className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-black/85 px-1.5 py-0.5 text-center text-[10px] font-bold leading-tight text-white">
        {label}{sub ? <><br /><span className="font-mono font-semibold">({sub})</span></> : null}
      </div>
      <div
        className="h-full w-full rounded-sm border-2"
        style={{
          borderColor: selected ? "#ffffff" : color,
          borderWidth: selected ? 3 : 2,
          boxShadow: `0 0 10px 0 ${color}66`,
        }}
      />
    </div>
  );
}

export function CellImportanceLegend() {
  const rows = [
    { color: "#f87171", label: "High (dynamic / critical)" },
    { color: "#fbbf24", label: "Medium (relevant object)" },
    { color: "#38bdf8", label: "Low (static / background)" },
    { color: "#64748b", label: "Unallocated (empty region)" },
  ];
  return (
    <div className="absolute right-2 top-2 rounded-lg border border-line/60 bg-slate-950/85 p-2.5 backdrop-blur-sm">
      <div className="mb-1.5 text-[11px] font-bold text-white">Cell Importance</div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-300" key={r.label}>
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />
            {r.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ResourceUsageBar({ tone, pct, note }) {
  const barColor = tone === "red" ? "bg-rose-500" : "bg-cyanSignal";
  return (
    <div className="rounded-lg border border-line bg-black/20 p-3">
      <div className="text-sm font-bold text-white">Resource Usage</div>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-xs text-slate-400">{note}</div>
    </div>
  );
}

export function BulletCard({ tone, icon, title, items }) {
  const toneClass = tone === "red" ? "text-rose-400" : "text-emerald-400";
  const dotClass = tone === "red" ? "bg-rose-400" : "bg-emerald-400";
  return (
    <div className="rounded-lg border border-line bg-black/20 p-3">
      <div className={`flex items-center gap-1.5 text-sm font-bold ${toneClass}`}>{icon} {title}</div>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li className="flex items-start gap-2 text-xs text-slate-300" key={item}>
            <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${dotClass}`} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Scene objects -------------------------------------------------------
// Each sprite is a self-contained SVG placed by container-% CENTER point, so
// it nests inside a matching SceneBox. Own viewBox => no stretching.
// pointer-events stay off by default (purely decorative); pair with a
// SceneBox (or another overlay) on top for click targets.
export function ObjectSprite({ cx, cy, w, viewBox, glow, children }) {
  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${cx}%`, top: `${cy}%`, width: `${w}%` }}
    >
      <svg className="h-auto w-full" style={glow ? { filter: `drop-shadow(0 0 3px ${glow})` } : undefined} viewBox={viewBox}>
        {children}
      </svg>
    </div>
  );
}

export function EgoCar({ cx = 51, cy = 95, w = 24 }) {
  return (
    <ObjectSprite cx={cx} cy={cy} glow="#ef4444" viewBox="0 0 120 74" w={w}>
      <ellipse cx="60" cy="69" fill="#000" opacity="0.5" rx="52" ry="6" />
      <path d="M12 46 Q14 30 30 26 L90 26 Q106 30 108 46 L110 60 Q110 66 104 66 L16 66 Q10 66 10 60 Z" fill="#1e2636" />
      <path d="M34 27 Q38 16 60 15 Q82 16 86 27 Z" fill="#0f1626" />
      <path d="M39 27 Q43 20 60 19 Q77 20 81 27 Z" fill="#22304a" />
      <rect fill="#ef4444" height="9" rx="3" width="26" x="15" y="44" />
      <rect fill="#ef4444" height="9" rx="3" width="26" x="79" y="44" />
      <rect fill="#0b1120" height="6" rx="1.5" width="20" x="50" y="56" />
    </ObjectSprite>
  );
}

// color drives both the glow and the accent (lights/wheels) so the same
// sprite can read as "critical" (red), "relevant" (amber) or "static" (blue)
// depending on context, instead of always being hard-coded red.
export function TruckSprite({ cx, cy, w, color = "#ef4444" }) {
  return (
    <ObjectSprite cx={cx} cy={cy} glow={color} viewBox="0 0 70 92" w={w}>
      <rect fill="#232b3d" height="66" rx="3" stroke="#334155" strokeWidth="2" width="50" x="10" y="6" />
      <rect fill="#0f1626" height="8" width="12" x="18" y="58" />
      <rect fill="#0f1626" height="8" width="12" x="40" y="58" />
      <rect fill="#1a2230" height="14" rx="2" width="44" x="13" y="72" />
      <circle cx="22" cy="88" fill={color} r="4" />
      <circle cx="48" cy="88" fill={color} r="4" />
    </ObjectSprite>
  );
}

export function CarSprite({ cx, cy, w, color = "#ef4444" }) {
  return (
    <ObjectSprite cx={cx} cy={cy} glow={color} viewBox="0 0 96 66" w={w}>
      <ellipse cx="48" cy="61" fill="#000" opacity="0.5" rx="42" ry="5" />
      <path d="M8 40 Q10 26 24 22 L72 22 Q86 26 88 40 L90 52 Q90 58 84 58 L12 58 Q6 58 6 52 Z" fill="#20293a" />
      <path d="M26 23 Q30 13 48 12 Q66 13 70 23 Z" fill="#101827" />
      <path d="M30 23 Q34 17 48 16 Q62 17 66 23 Z" fill="#26324a" />
      <rect fill={color} height="8" rx="2.5" width="18" x="12" y="38" />
      <rect fill={color} height="8" rx="2.5" width="18" x="66" y="38" />
    </ObjectSprite>
  );
}

// A pedestrian standing on the side of the road (dynamic / critical by
// default, but color can be overridden the same way as the vehicles).
export function PedestrianSprite({ cx, cy, w, color = "#ef4444" }) {
  return (
    <ObjectSprite cx={cx} cy={cy} glow={color} viewBox="0 0 30 86" w={w}>
      <ellipse cx="15" cy="82" fill="#000" opacity="0.4" rx="9" ry="3" />
      <circle cx="15" cy="11" fill="#1e2636" r="7" />
      <rect fill="#2b3444" height="28" rx="5" width="14" x="8" y="19" />
      <rect fill="#1a2230" height="28" rx="3" width="5" x="9" y="47" />
      <rect fill="#1a2230" height="28" rx="3" width="5" x="16" y="47" />
      <circle cx="15" cy="30" fill={color} r="2.4" />
    </ObjectSprite>
  );
}

// A four-legged animal on the road, side view, drawn in the same pixel-art
// style as the other sprites (flat shapes, a single accent-colored "sensor
// glow" point standing in for the eye). Color follows the same convention:
// red when it's a live hazard, amber when merely relevant, etc.
export function AnimalSprite({ cx, cy, w, color = "#ef4444" }) {
  const body = "#2b3444";
  const dark = "#1a2230";
  return (
    <ObjectSprite cx={cx} cy={cy} glow={color} viewBox="0 0 64 48" w={w}>
      <ellipse cx="32" cy="45" fill="#000" opacity="0.4" rx="22" ry="3" />
      {/* back legs */}
      <rect fill={dark} height="16" rx="2" width="4.5" x="14" y="26" />
      <rect fill={dark} height="16" rx="2" width="4.5" x="23" y="26" />
      {/* front legs */}
      <rect fill={dark} height="20" rx="2" width="4.5" x="43" y="22" />
      <rect fill={dark} height="20" rx="2" width="4.5" x="52" y="22" />
      {/* tail */}
      <path d="M10 20 Q3 15 7 8" fill="none" stroke={dark} strokeLinecap="round" strokeWidth="3" />
      {/* body */}
      <ellipse cx="32" cy="24" fill={body} rx="20" ry="10" />
      {/* neck */}
      <path d="M46 18 Q56 13 54 8 Q48 6 44 14 Z" fill={body} />
      {/* head */}
      <circle cx="53" cy="9" fill="#1e2636" r="6" />
      {/* ears */}
      <path d="M49,5 L47,0 L52,3 Z" fill={dark} />
      <path d="M57,5 L59,0 L54,3 Z" fill={dark} />
      {/* eye / sensor glow */}
      <circle cx="55.5" cy="8.5" fill={color} r="1.2" />
    </ObjectSprite>
  );
}

// A building on the side of the road (static / background).
export function BuildingSprite({ cx, cy, w }) {
  const windows = [];
  for (let r = 0; r < 6; r += 1) {
    for (let c = 0; c < 3; c += 1) windows.push([c, r]);
  }
  return (
    <ObjectSprite cx={cx} cy={cy} glow="#1e3a5f" viewBox="0 0 60 120" w={w}>
      <rect fill="#0f1626" height="6" rx="1" width="56" x="2" y="4" />
      <rect fill="#141c2e" height="112" rx="2" stroke="#243044" strokeWidth="2" width="52" x="4" y="8" />
      {windows.map(([c, r], i) => {
        const lit = (r * 3 + c) % 3 === 0;
        return (
          <rect
            key={i}
            x={11 + c * 14}
            y={18 + r * 16}
            width={9}
            height={10}
            rx="1"
            fill={lit ? "#fde68a" : "#1f2b40"}
            opacity={lit ? 0.85 : 1}
          />
        );
      })}
    </ObjectSprite>
  );
}

// A roadside information sign standing near the ego (static / background).
export function SignSprite({ cx, cy, w }) {
  return (
    <ObjectSprite cx={cx} cy={cy} viewBox="0 0 30 80" w={w}>
      <ellipse cx="15" cy="77" fill="#000" opacity="0.4" rx="7" ry="2.5" />
      <rect fill="#3b4759" height="52" width="2.6" x="13.7" y="26" />
      <rect fill="#1f2b40" height="22" rx="2" stroke="#64748b" strokeWidth="1.5" width="26" x="2" y="4" />
      <rect fill="#334155" height="4" rx="1" width="16" x="7" y="9" />
      <rect fill="#334155" height="4" rx="1" width="12" x="7" y="16" />
    </ObjectSprite>
  );
}