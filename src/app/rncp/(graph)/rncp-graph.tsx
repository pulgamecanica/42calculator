"use client";

import { cn } from "@/lib/utils";
import { useFortyTwoStore } from "@/providers/forty-two-store-provider";
import { usePlannedProjects } from "@/stores/planned-projects-store";
import type {
  FortyTwoCursus,
  FortyTwoTitle,
  FortyTwoTitleOption,
} from "@/types/forty-two";
import { useMemo, useRef, useState } from "react";

const SIZE = 1000;
const CENTER = SIZE / 2;
const DONUT_INNER = 80;
const DONUT_OUTER = 140;
const ANCHOR_R = 290;
const NODE_R = 9;
const MIN_R = 168; // keep nodes outside the donut
const MAX_R = 478;
const ITERATIONS = 220;
const PAN_LIMIT = 600;

const SEGMENT_COLORS = [
  "#f5c542",
  "#38bdf8",
  "#a78bfa",
  "#fb7185",
  "#34d399",
  "#f97316",
];

interface Anchor {
  key: string;
  titleIndex: number;
  optionIndex: number;
  color: string;
  angle: number;
  x: number;
  y: number;
}

interface LayoutNode {
  key: string;
  anchorKey: string;
  titleIndex: number;
  projectId: number;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  shared: boolean;
}

interface Segment {
  title: FortyTwoTitle;
  color: string;
  a0: number;
  a1: number;
  mid: number;
}

/** angle 0 = top, increasing clockwise. */
function polar(radius: number, angle: number) {
  return {
    x: CENTER + radius * Math.sin(angle),
    y: CENTER - radius * Math.cos(angle),
  };
}

function annularSector(r0: number, r1: number, a0: number, a1: number): string {
  const p0o = polar(r1, a0);
  const p1o = polar(r1, a1);
  const p1i = polar(r0, a1);
  const p0i = polar(r0, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p0o.x} ${p0o.y} A ${r1} ${r1} 0 ${large} 1 ${p1o.x} ${p1o.y} L ${p1i.x} ${p1i.y} A ${r0} ${r0} 0 ${large} 0 ${p0i.x} ${p0i.y} Z`;
}

function isOptionComplete(
  option: FortyTwoTitleOption,
  cursus: FortyTwoCursus,
  planned: Record<number, unknown>,
): boolean {
  let projects = 0;
  let experience = 0;
  for (const project of Object.values(option.projects)) {
    const userProject = cursus.projects[project.id];
    if (userProject?.is_validated) {
      projects++;
      experience += (project.experience || 0) * ((userProject.mark || 0) / 100);
    } else if (planned[project.id]) {
      projects++;
      experience += project.experience || 0;
    }
  }
  return (
    projects >= option.numberOfProjects &&
    (option.experience === 0 || experience >= option.experience)
  );
}

export function RncpGraph({ titles }: { titles: FortyTwoTitle[] }) {
  const { cursus } = useFortyTwoStore((state) => state);
  const planned = usePlannedProjects((state) => state.planned);
  const toggle = usePlannedProjects((state) => state.toggle);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<number | null>(null);
  const drag = useRef<{
    px: number;
    py: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);

  // Layout only depends on the (static) titles + cursus, NOT on `planned`, so
  // toggling a project recolours without re-running the relaxation.
  const { nodes, anchors, segments } = useMemo(() => {
    const count = titles.length || 1;
    const sweep = (Math.PI * 2) / count;
    const titlePad = Math.min(0.08, sweep * 0.12);

    const titlesPerProject = new Map<number, Set<number>>();
    titles.forEach((title, ti) => {
      for (const option of title.options) {
        for (const id of Object.keys(option.projects).map(Number)) {
          if (!titlesPerProject.has(id)) titlesPerProject.set(id, new Set());
          titlesPerProject.get(id)?.add(ti);
        }
      }
    });

    const segments: Segment[] = titles.map((title, i) => ({
      title,
      color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
      a0: i * sweep,
      a1: (i + 1) * sweep,
      mid: i * sweep + sweep / 2,
    }));

    const anchors: Anchor[] = [];
    const nodes: LayoutNode[] = [];

    titles.forEach((title, titleIndex) => {
      const color = SEGMENT_COLORS[titleIndex % SEGMENT_COLORS.length];
      const t0 = titleIndex * sweep + titlePad;
      const t1 = (titleIndex + 1) * sweep - titlePad;
      const options = title.options;

      options.forEach((option, optionIndex) => {
        const angle =
          options.length <= 1
            ? (t0 + t1) / 2
            : t0 + ((t1 - t0) * (optionIndex + 0.5)) / options.length;
        const radius = ANCHOR_R + (optionIndex % 2) * 44;
        const anchorPos = polar(radius, angle);
        const anchorKey = `${titleIndex}:${optionIndex}`;

        anchors.push({
          key: anchorKey,
          titleIndex,
          optionIndex,
          color,
          angle,
          x: anchorPos.x,
          y: anchorPos.y,
        });

        Object.values(option.projects).forEach((project, k) => {
          // seed nodes in a small sunflower around their anchor
          const t = k * 2.3999632;
          const rr = 7 * Math.sqrt(k + 1);
          nodes.push({
            key: `${anchorKey}:${project.id}:${k}`,
            anchorKey,
            titleIndex,
            projectId: project.id,
            name: project.name,
            x: anchorPos.x + rr * Math.cos(t),
            y: anchorPos.y + rr * Math.sin(t),
            vx: 0,
            vy: 0,
            shared: (titlesPerProject.get(project.id)?.size ?? 0) > 1,
          });
        });
      });
    });

    const anchorByKey = new Map(anchors.map((a) => [a.key, a]));
    const minDist = 2 * NODE_R + 4;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      // attract each node to its option anchor (grouping)
      for (const n of nodes) {
        const a = anchorByKey.get(n.anchorKey);
        if (!a) continue;
        n.vx += (a.x - n.x) * 0.03;
        n.vy += (a.y - n.y) * 0.03;
      }

      // collision (no overlaps)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d = Math.hypot(dx, dy) || 0.01;
          if (d < minDist) {
            const push = (minDist - d) / 2;
            dx /= d;
            dy /= d;
            a.x -= dx * push;
            a.y -= dy * push;
            b.x += dx * push;
            b.y += dy * push;
          }
        }
      }

      // integrate + damping + radial bounds
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        n.vx *= 0.8;
        n.vy *= 0.8;
        const dx = n.x - CENTER;
        const dy = n.y - CENTER;
        const r = Math.hypot(dx, dy) || 0.01;
        if (r < MIN_R) {
          n.x = CENTER + (dx / r) * MIN_R;
          n.y = CENTER + (dy / r) * MIN_R;
          n.vx = 0;
          n.vy = 0;
        } else if (r > MAX_R) {
          n.x = CENTER + (dx / r) * MAX_R;
          n.y = CENTER + (dy / r) * MAX_R;
        }
      }
    }

    return { nodes, anchors, segments };
  }, [titles, cursus]);

  const completeByAnchor = useMemo(() => {
    const map: Record<string, boolean> = {};
    titles.forEach((title, ti) => {
      title.options.forEach((option, oi) => {
        map[`${ti}:${oi}`] = isOptionComplete(option, cursus, planned);
      });
    });
    return map;
  }, [titles, cursus, planned]);

  const nodesByAnchor = useMemo(() => {
    const map = new Map<string, LayoutNode[]>();
    for (const n of nodes) {
      if (!map.has(n.anchorKey)) map.set(n.anchorKey, []);
      map.get(n.anchorKey)?.push(n);
    }
    return map;
  }, [nodes]);

  const selectedNodes = selectedProject
    ? nodes.filter((n) => n.projectId === selectedProject)
    : [];
  const selectedName = selectedNodes[0]?.name;

  const isActive = (n: LayoutNode) =>
    (selectedProject === null && selectedTitle === null) ||
    n.projectId === selectedProject ||
    n.titleIndex === selectedTitle;

  function clearSelection() {
    setSelectedProject(null);
    setSelectedTitle(null);
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: pan.x, oy: pan.y, moved: false };
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.px;
    const dy = e.clientY - drag.current.py;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    const scale = SIZE / (e.currentTarget.clientWidth || SIZE);
    const clamp = (v: number) => Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, v));
    setPan({ x: clamp(drag.current.ox + dx * scale), y: clamp(drag.current.oy + dy * scale) });
  }
  function onPointerUp() {
    if (drag.current && !drag.current.moved) clearSelection();
    drag.current = null;
  }

  return (
    <div className="relative w-full overflow-hidden rounded-lg border bg-card/20">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-[74vh] max-h-[880px] w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        role="img"
        aria-label="RNCP certificates graph"
      >
        <g transform={`translate(${pan.x} ${pan.y})`}>
          {/* Option "sections": stem donut→hub + hub→node links. */}
          {anchors.map((a) => {
            const stem = polar(DONUT_OUTER, a.angle);
            const complete = completeByAnchor[a.key];
            const dim = selectedTitle !== null && a.titleIndex !== selectedTitle;
            const links = nodesByAnchor.get(a.key) ?? [];
            return (
              <g
                key={`anchor-${a.key}`}
                opacity={dim ? 0.15 : 1}
              >
                {links.map((n) => (
                  <line
                    key={`hublink-${n.key}`}
                    x1={a.x}
                    y1={a.y}
                    x2={n.x}
                    y2={n.y}
                    stroke={complete ? a.color : "currentColor"}
                    className={complete ? "" : "text-muted-foreground/15"}
                    strokeOpacity={complete ? 0.35 : 1}
                    strokeWidth={1.1}
                  />
                ))}
                <line
                  x1={stem.x}
                  y1={stem.y}
                  x2={a.x}
                  y2={a.y}
                  stroke={a.color}
                  strokeWidth={complete ? 5 : 2.5}
                  strokeOpacity={complete ? 0.9 : 0.4}
                  style={
                    complete ? { filter: `drop-shadow(0 0 5px ${a.color})` } : undefined
                  }
                />
                <circle
                  cx={a.x}
                  cy={a.y}
                  r={complete ? 9 : 6}
                  fill={a.color}
                  fillOpacity={complete ? 1 : 0.5}
                  className="stroke-background"
                  strokeWidth={2}
                  style={
                    complete ? { filter: `drop-shadow(0 0 6px ${a.color})` } : undefined
                  }
                />
              </g>
            );
          })}

          {/* Links between every instance of the selected project. */}
          {selectedNodes.map((n) => (
            <line
              key={`sel-${n.key}`}
              x1={CENTER}
              y1={CENTER}
              x2={n.x}
              y2={n.y}
              className="stroke-sky-400/70"
              strokeWidth={3}
            />
          ))}

          {/* Donut segments (certificates) — click to highlight. */}
          {segments.map((s, i) => {
            const labelPos = polar((DONUT_INNER + DONUT_OUTER) / 2, s.mid);
            const sel = selectedTitle === i;
            return (
              <g
                key={`seg-${i}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setSelectedProject(null);
                  setSelectedTitle((prev) => (prev === i ? null : i));
                }}
                className="cursor-pointer"
              >
                <path
                  d={annularSector(DONUT_INNER, DONUT_OUTER, s.a0, s.a1)}
                  fill={s.color}
                  fillOpacity={sel ? 1 : 0.85}
                  className="stroke-background"
                  strokeWidth={3}
                  style={sel ? { filter: `drop-shadow(0 0 8px ${s.color})` } : undefined}
                />
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-black/80 font-bold"
                  fontSize={26}
                >
                  {i + 1}
                </text>
              </g>
            );
          })}

          {/* Project nodes — click toggles simulation + isolates across certs. */}
          {nodes.map((n) => {
            const sel = n.projectId === selectedProject;
            const active = isActive(n);
            const validated = cursus.projects[n.projectId]?.is_validated ?? false;
            const isPlanned = Boolean(planned[n.projectId]);
            return (
              <g
                key={`node-${n.key}`}
                transform={`translate(${n.x} ${n.y})`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setSelectedTitle(null);
                  setSelectedProject(n.projectId);
                  if (!validated) toggle(n.projectId);
                }}
                className="cursor-pointer"
                opacity={active ? 1 : 0.18}
              >
                <circle
                  r={sel ? NODE_R + 4 : NODE_R}
                  className={cn(
                    validated
                      ? "fill-primary"
                      : isPlanned
                        ? "fill-sky-500"
                        : "fill-muted-foreground/40",
                  )}
                  stroke={sel ? "#38bdf8" : n.shared ? "#e5e7eb" : "none"}
                  strokeWidth={sel ? 4 : n.shared ? 2.5 : 0}
                />
              </g>
            );
          })}
        </g>
      </svg>

      {selectedName && (
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border bg-background/90 px-3 py-1 font-medium text-sm shadow-sm">
          {selectedName}
          {new Set(selectedNodes.map((n) => n.titleIndex)).size > 1 && (
            <span className="ml-2 text-sky-500">
              in {new Set(selectedNodes.map((n) => n.titleIndex)).size} certs
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t bg-background/60 px-4 py-2 text-xs">
        {segments.map((s, i) => (
          <span
            key={`legend-${i}`}
            className="flex items-center gap-1.5"
          >
            <span
              className="inline-block size-3 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="font-medium">{i + 1}.</span>
            <span className="text-muted-foreground">{s.title.title}</span>
          </span>
        ))}
        <span className="ml-auto text-muted-foreground">
          drag to pan · click a cert or a project · click a project to simulate it
        </span>
      </div>
    </div>
  );
}
