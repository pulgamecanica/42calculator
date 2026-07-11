"use client";

import { cn } from "@/lib/utils";
import { useFortyTwoStore } from "@/providers/forty-two-store-provider";
import { usePlannedProjects } from "@/stores/planned-projects-store";
import type {
  FortyTwoCursus,
  FortyTwoTitle,
  FortyTwoTitleOption,
} from "@/types/forty-two";
import { Minus, Plus, Scan } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PolarPath } from "./polar-path";

const SIZE = 1000;
const CENTER = SIZE / 2;
const DONUT_INNER = 80;
const DONUT_OUTER = 138;
const LEVEL_BASE = 176;
const LEVEL_GAP = 48;
const SLOT = 0.07; // angular spacing between nodes on a level (rad)
const NODE_R = 8;
const CHILD_R = 4;
const PAN_LIMIT = 600;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 5;

const SEGMENT_COLORS = [
  "#f5c542",
  "#38bdf8",
  "#a78bfa",
  "#fb7185",
  "#34d399",
  "#f97316",
];

const levelRadius = (level: number) => LEVEL_BASE + level * LEVEL_GAP;

interface GraphNode {
  key: string;
  anchorKey: string;
  titleIndex: number;
  projectId: number;
  name: string;
  x: number;
  y: number;
  shared: boolean;
}

interface ChildNode {
  key: string;
  titleIndex: number;
  name: string;
  x: number;
  y: number;
  px: number;
  py: number;
}

interface Spine {
  key: string;
  anchorKey: string;
  titleIndex: number;
  d: string;
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
  const [zoom, setZoom] = useState(1);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  panRef.current = pan;
  zoomRef.current = zoom;
  const drag = useRef<{
    px: number;
    py: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);

  const clampPan = (p: { x: number; y: number }, z: number) => {
    const limit = PAN_LIMIT + (SIZE * (z - 1)) / 2;
    return {
      x: Math.max(-limit, Math.min(limit, p.x)),
      y: Math.max(-limit, Math.min(limit, p.y)),
    };
  };

  const zoomAt = (svgX: number, svgY: number, factor: number) => {
    const z0 = zoomRef.current;
    const z1 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z0 * factor));
    if (z1 === z0) return;
    const p0 = panRef.current;
    setPan(
      clampPan(
        {
          x: svgX - (svgX - p0.x) * (z1 / z0),
          y: svgY - (svgY - p0.y) * (z1 / z0),
        },
        z1,
      ),
    );
    setZoom(z1);
  };

  // Native wheel listener (non-passive) so we can zoom toward the cursor
  // without scrolling the page.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const toSvg = SIZE / rect.width;
      zoomAt(
        (e.clientX - rect.left) * toSvg,
        (e.clientY - rect.top) * toSvg,
        e.deltaY < 0 ? 1.12 : 1 / 1.12,
      );
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deterministic (idempotent) grid layout — depends only on the static
  // titles/cursus, so toggling a project only recolours.
  const { nodes, children, spines, segments } = useMemo(() => {
    const count = titles.length || 1;
    const sweep = (Math.PI * 2) / count;
    const titlePad = Math.min(0.08, sweep * 0.1);
    const sectionGap = 0.02;

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

    const nodes: GraphNode[] = [];
    const children: ChildNode[] = [];
    const spines: Spine[] = [];

    titles.forEach((title, titleIndex) => {
      const t0 = titleIndex * sweep + titlePad;
      const t1 = (titleIndex + 1) * sweep - titlePad;
      const options = title.options;
      const weights = options.map((o) =>
        Math.max(1, Object.keys(o.projects).length),
      );
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const available = t1 - t0 - sectionGap * Math.max(0, options.length - 1);

      let cursor = t0;
      options.forEach((option, optionIndex) => {
        const share = weights[optionIndex] / totalWeight;
        const s0 = cursor;
        const s1 = cursor + available * share;
        cursor = s1 + sectionGap;

        const anchorKey = `${titleIndex}:${optionIndex}`;
        const pad = Math.min(0.015, (s1 - s0) * 0.12);
        const trunkStart = s0 + pad;
        const usable = s1 - s0 - 2 * pad;
        const perLevel = Math.max(1, Math.floor(usable / SLOT));
        const slotAngle = (slot: number) => trunkStart + SLOT * (slot + 0.5);

        const projects = Object.values(option.projects);
        const total = projects.length;
        const levels = Math.ceil(total / perLevel) || 1;

        // Nodes on a left-aligned polar grid (shared levels + columns).
        projects.forEach((project, k) => {
          const level = Math.floor(k / perLevel);
          const slot = k % perLevel;
          const radius = levelRadius(level);
          const angle = slotAngle(slot);
          const { x, y } = polar(radius, angle);

          nodes.push({
            key: `${anchorKey}:${project.id}:${k}`,
            anchorKey,
            titleIndex,
            projectId: project.id,
            name: project.name,
            x,
            y,
            shared: (titlesPerProject.get(project.id)?.size ?? 0) > 1,
          });

          // A piscine / parent project: render its children as a small
          // connected sub-cluster just outside the node.
          const kids = project.children ?? [];
          if (kids.length > 0) {
            const spread = SLOT * 0.9;
            kids.forEach((child, ci) => {
              const ca =
                angle - spread / 2 + (spread * (ci + 0.5)) / kids.length;
              const cp = polar(radius + LEVEL_GAP * 0.5, ca);
              children.push({
                key: `${anchorKey}:${project.id}:${k}:c${child.id}:${ci}`,
                titleIndex,
                name: child.name,
                x: cp.x,
                y: cp.y,
                px: x,
                py: y,
              });
            });
          }
        });

        // Serpentine spine: snake out level by level, alternating direction.
        const spine = new PolarPath(CENTER, CENTER)
          .moveTo(DONUT_OUTER, slotAngle(0))
          .radialTo(levelRadius(0));
        for (let level = 0; level < levels; level++) {
          const countL = Math.min(perLevel, total - level * perLevel);
          const order: number[] = [];
          for (let j = 0; j < countL; j++) order.push(j);
          if (level % 2 === 1) order.reverse();
          if (level > 0) spine.radialTo(levelRadius(level));
          for (const slot of order) spine.arcTo(slotAngle(slot));
        }

        spines.push({
          key: anchorKey,
          anchorKey,
          titleIndex,
          d: spine.toString(),
        });
      });
    });

    return { nodes, children, spines, segments };
  }, [titles]);

  const completeByAnchor = useMemo(() => {
    const map: Record<string, boolean> = {};
    titles.forEach((title, ti) => {
      title.options.forEach((option, oi) => {
        map[`${ti}:${oi}`] = isOptionComplete(option, cursus, planned);
      });
    });
    return map;
  }, [titles, cursus, planned]);

  const selectedNodes = selectedProject
    ? nodes.filter((n) => n.projectId === selectedProject)
    : [];
  const selectedName = selectedNodes[0]?.name;

  const isActive = (n: GraphNode) =>
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
    setPan(
      clampPan(
        { x: drag.current.ox + dx * scale, y: drag.current.oy + dy * scale },
        zoom,
      ),
    );
  }
  function onPointerUp() {
    if (drag.current && !drag.current.moved) clearSelection();
    drag.current = null;
  }

  return (
    <div className="relative w-full overflow-hidden rounded-lg border bg-card/20">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-[74vh] max-h-[880px] w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        role="img"
        aria-label="RNCP certificates graph"
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {/* Serpentine spine per option (snakes out level by level). */}
          {spines.map((s) => {
            const complete = completeByAnchor[s.anchorKey];
            const dim =
              (selectedTitle !== null && s.titleIndex !== selectedTitle) ||
              selectedProject !== null;
            const color = SEGMENT_COLORS[s.titleIndex % SEGMENT_COLORS.length];
            return (
              <path
                key={`spine-${s.key}`}
                d={s.d}
                fill="none"
                stroke={complete ? color : "currentColor"}
                className={complete ? "" : "text-muted-foreground/25"}
                strokeWidth={complete ? 3 : 1.5}
                strokeOpacity={complete ? 0.55 : 1}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={dim ? 0.12 : 1}
                style={
                  complete ? { filter: `drop-shadow(0 0 4px ${color})` } : undefined
                }
              />
            );
          })}

          {/* Piscine children (sub-projects). */}
          {children.map((c) => {
            const dim =
              (selectedTitle !== null && c.titleIndex !== selectedTitle) ||
              selectedProject !== null;
            return (
              <g
                key={`child-${c.key}`}
                opacity={dim ? 0.1 : 0.85}
              >
                <line
                  x1={c.px}
                  y1={c.py}
                  x2={c.x}
                  y2={c.y}
                  className="stroke-muted-foreground/30"
                  strokeWidth={1}
                />
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={CHILD_R}
                  className="fill-muted-foreground/50"
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
              className="stroke-sky-400/60"
              strokeWidth={2.5}
              strokeDasharray="4 6"
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

          {/* Project nodes. */}
          {nodes.map((n) => {
            const sel = n.projectId === selectedProject;
            const active = isActive(n);
            const validated = cursus.projects[n.projectId]?.is_validated ?? false;
            const isPlanned = Boolean(planned[n.projectId]);
            return (
              <circle
                key={`node-${n.key}`}
                cx={n.x}
                cy={n.y}
                r={sel ? NODE_R + 4 : NODE_R}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setSelectedTitle(null);
                  setSelectedProject(n.projectId);
                  if (!validated) toggle(n.projectId);
                }}
                className={cn(
                  "cursor-pointer",
                  validated
                    ? "fill-primary"
                    : isPlanned
                      ? "fill-sky-500"
                      : "fill-muted-foreground/40",
                )}
                stroke={sel ? "#38bdf8" : n.shared ? "#e5e7eb" : "none"}
                strokeWidth={sel ? 4 : n.shared ? 2.5 : 0}
                opacity={active ? 1 : 0.18}
              />
            );
          })}
        </g>
      </svg>

      {/* Zoom controls. */}
      <div className="absolute top-3 right-3 flex flex-col overflow-hidden rounded-md border bg-background/90 shadow-sm">
        <button
          type="button"
          aria-label="Zoom in"
          className="flex size-8 items-center justify-center hover:bg-muted"
          onClick={() => zoomAt(SIZE / 2, SIZE / 2, 1.25)}
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          className="flex size-8 items-center justify-center border-t hover:bg-muted"
          onClick={() => zoomAt(SIZE / 2, SIZE / 2, 1 / 1.25)}
        >
          <Minus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Reset view"
          className="flex size-8 items-center justify-center border-t hover:bg-muted"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          <Scan className="size-4" />
        </button>
      </div>

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
