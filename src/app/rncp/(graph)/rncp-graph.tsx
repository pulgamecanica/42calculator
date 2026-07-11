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
const DONUT_INNER = 78;
const DONUT_OUTER = 140;
const SECTION_ARC = 158;
const RING_BASE = 188;
const RING_GAP = 46;
const NODE_R = 9;
const NODE_ANGLE_STEP = 0.13; // spacing between nodes along a ring (rad)
const PAN_LIMIT = 560;

const SEGMENT_COLORS = [
  "#f5c542",
  "#38bdf8",
  "#a78bfa",
  "#fb7185",
  "#34d399",
  "#f97316",
];

interface GraphNode {
  key: string;
  titleIndex: number;
  projectId: number;
  name: string;
  x: number;
  y: number;
  angle: number;
  validated: boolean;
  shared: boolean;
}

interface GraphSection {
  key: string;
  titleIndex: number;
  color: string;
  a0: number;
  a1: number;
  complete: boolean;
}

interface GraphSegment {
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

function arcPath(radius: number, a0: number, a1: number): string {
  const p0 = polar(radius, a0);
  const p1 = polar(radius, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${radius} ${radius} 0 ${large} 1 ${p1.x} ${p1.y}`;
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
  const projectsMet = projects >= option.numberOfProjects;
  const experienceMet =
    option.experience === 0 || experience >= option.experience;
  return projectsMet && experienceMet;
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

  const { nodes, sections, segments } = useMemo(() => {
    const count = titles.length || 1;
    const sweep = (Math.PI * 2) / count;
    const titlePad = Math.min(0.06, sweep * 0.1);
    const sectionGap = 0.025;

    // A project counts as "shared" when it appears in more than one title.
    const titlesPerProject = new Map<number, Set<number>>();
    titles.forEach((title, ti) => {
      for (const option of title.options) {
        for (const id of Object.keys(option.projects).map(Number)) {
          if (!titlesPerProject.has(id)) titlesPerProject.set(id, new Set());
          titlesPerProject.get(id)?.add(ti);
        }
      }
    });

    const segments: GraphSegment[] = titles.map((title, i) => ({
      title,
      color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
      a0: i * sweep,
      a1: (i + 1) * sweep,
      mid: i * sweep + sweep / 2,
    }));

    const nodes: GraphNode[] = [];
    const sections: GraphSection[] = [];

    titles.forEach((title, titleIndex) => {
      const color = SEGMENT_COLORS[titleIndex % SEGMENT_COLORS.length];
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

        sections.push({
          key: `${titleIndex}:${optionIndex}`,
          titleIndex,
          color,
          a0: s0,
          a1: s1,
          complete: isOptionComplete(option, cursus, planned),
        });

        const projects = Object.values(option.projects);
        const inPad = Math.min(0.02, (s1 - s0) * 0.15);
        const perRing = Math.max(2, Math.round((s1 - s0 - 2 * inPad) / NODE_ANGLE_STEP));

        let ring = 0;
        let start = 0;
        while (start < projects.length) {
          const inThisRing = Math.min(perRing, projects.length - start);
          const radius = RING_BASE + ring * RING_GAP;
          for (let i = 0; i < inThisRing; i++) {
            const project = projects[start + i];
            const angle =
              inThisRing <= 1
                ? (s0 + s1) / 2
                : s0 + inPad + ((s1 - s0 - 2 * inPad) * i) / (inThisRing - 1);
            const { x, y } = polar(radius, angle);
            nodes.push({
              key: `${titleIndex}:${optionIndex}:${project.id}:${start + i}`,
              titleIndex,
              projectId: project.id,
              name: project.name,
              x,
              y,
              angle,
              validated: cursus.projects[project.id]?.is_validated ?? false,
              shared: (titlesPerProject.get(project.id)?.size ?? 0) > 1,
            });
          }
          start += inThisRing;
          ring += 1;
        }
      });
    });

    return { nodes, sections, segments };
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
    drag.current = {
      px: e.clientX,
      py: e.clientY,
      ox: pan.x,
      oy: pan.y,
      moved: false,
    };
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.px;
    const dy = e.clientY - drag.current.py;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    const scale = SIZE / (e.currentTarget.clientWidth || SIZE);
    const clamp = (v: number) => Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, v));
    setPan({
      x: clamp(drag.current.ox + dx * scale),
      y: clamp(drag.current.oy + dy * scale),
    });
  }

  function onPointerUp() {
    if (drag.current && !drag.current.moved) clearSelection();
    drag.current = null;
  }

  return (
    <div className="relative w-full overflow-hidden rounded-lg border bg-card/20">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-[74vh] max-h-[860px] w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        role="img"
        aria-label="RNCP certificates graph"
      >
        <g transform={`translate(${pan.x} ${pan.y})`}>
          {/* Links between every instance of the selected project. */}
          {selectedNodes.map((n) => (
            <line
              key={`link-${n.key}`}
              x1={CENTER}
              y1={CENTER}
              x2={n.x}
              y2={n.y}
              className="stroke-sky-400/70"
              strokeWidth={3}
            />
          ))}

          {/* Section base arcs (glow when the option is complete). */}
          {sections.map((s) => {
            const dim = selectedTitle !== null && s.titleIndex !== selectedTitle;
            return (
              <path
                key={`section-${s.key}`}
                d={arcPath(SECTION_ARC, s.a0, s.a1)}
                fill="none"
                stroke={s.complete ? s.color : "currentColor"}
                className={cn(
                  s.complete ? "text-foreground" : "text-muted-foreground/30",
                )}
                strokeWidth={s.complete ? 7 : 3}
                strokeLinecap="round"
                opacity={dim ? 0.25 : 1}
                style={
                  s.complete
                    ? { filter: `drop-shadow(0 0 6px ${s.color})` }
                    : undefined
                }
              />
            );
          })}

          {/* Branches (section arc → node). */}
          {nodes.map((n) => {
            const edge = polar(SECTION_ARC, n.angle);
            const active = isActive(n);
            const sel = n.projectId === selectedProject;
            return (
              <line
                key={`branch-${n.key}`}
                x1={edge.x}
                y1={edge.y}
                x2={n.x}
                y2={n.y}
                className={cn(
                  "stroke-muted-foreground/20",
                  sel && "stroke-sky-400/70",
                )}
                strokeWidth={sel ? 2.5 : 1.25}
                opacity={active ? 1 : 0.15}
              />
            );
          })}

          {/* Donut segments (one per certificate) — click to highlight a cert. */}
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
                  style={
                    sel ? { filter: `drop-shadow(0 0 8px ${s.color})` } : undefined
                  }
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

          {/* Project nodes — click toggles simulation (unless already done). */}
          {nodes.map((n) => {
            const sel = n.projectId === selectedProject;
            const active = isActive(n);
            const isPlanned = Boolean(planned[n.projectId]);
            return (
              <g
                key={`node-${n.key}`}
                transform={`translate(${n.x} ${n.y})`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setSelectedTitle(null);
                  setSelectedProject(n.projectId);
                  if (!n.validated) toggle(n.projectId);
                }}
                className="cursor-pointer"
                opacity={active ? 1 : 0.2}
              >
                <circle
                  r={sel ? NODE_R + 4 : NODE_R}
                  className={cn(
                    n.validated
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
          {selectedNodes.length > 1 && (
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
          drag to pan · click a cert or project · click a project to simulate it
        </span>
      </div>
    </div>
  );
}
