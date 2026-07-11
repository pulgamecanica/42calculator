import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompletionBar } from "@/components/ui/completion-bar";
import { useFortyTwoStore } from "@/providers/forty-two-store-provider";
import { useRncpSimulationStore } from "@/providers/rncp-simulation-provider";
import type {
  FortyTwoCursus,
  FortyTwoProject,
  FortyTwoTitle,
  FortyTwoTitleOption,
} from "@/types/forty-two";

interface TitleRequirementProps {
  name: string;
  value: number;
  max: number;
  unit?: string;
  /** Extra amount coming from simulated (not yet earned) projects. */
  simulatedValue?: number;
}

function TitleRequirement({
  name,
  value,
  max,
  unit,
  simulatedValue = 0,
}: TitleRequirementProps) {
  function formatValue(value: number) {
    if (value > 1000) {
      return `${(value / 1000).toFixed(1).toLocaleString()}K`;
    }
    return value.toLocaleString();
  }

  const total = value + simulatedValue;
  const percentage = max > 0 ? (total / max) * 100 : 0;
  const isOver = total > max;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 px-1 text-sm">
        <p className="truncate">{name}</p>
        <p className="text-right font-medium tabular-nums">
          {formatValue(value)}
          {simulatedValue > 0 && (
            <span className="text-sky-600 dark:text-sky-400">
              {" +"}
              {formatValue(simulatedValue)}
            </span>
          )}
          {" / "}
          {formatValue(max)} {unit}
          {isOver && (
            <span className="ml-1 font-normal text-muted-foreground text-xs">
              ({Math.round(percentage)}%)
            </span>
          )}
        </p>
      </div>
      <CompletionBar
        value={value}
        simulatedValue={simulatedValue}
        max={max}
        aria-label={`${total} out of ${max} for the ${name.toLowerCase()}`}
      />
    </div>
  );
}

export interface TitleRequirementsProps {
  title: FortyTwoTitle;
  className?: string;
}

export function TitleRequirements({
  title,
  className,
}: TitleRequirementsProps) {
  const { cursus } = useFortyTwoStore((state) => state);

  const experiences: FortyTwoProject[] = [];
  for (const project of Object.values(cursus.projects)) {
    const isExperience: boolean = title.experience[project.id] !== undefined;
    if (isExperience && project.is_validated) {
      experiences.push(project);
    }
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-4">
        <CardTitle
          tag="h3"
          className="text-xl"
        >
          Requirements
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
        <TitleRequirement
          name={"Level required"}
          value={cursus.level}
          max={title.level}
        />
        <TitleRequirement
          name={"Number of events"}
          value={cursus.events}
          max={title.numberOfEvents}
        />
        <TitleRequirement
          name={"Professional experiences"}
          value={experiences.length}
          max={title.numberOfExperiences}
        />
      </CardContent>
    </Card>
  );
}

interface Contribution {
  experience: number;
  projects: number;
  simulatedExperience: number;
  simulatedProjects: number;
}

function calculateExperience(
  project: FortyTwoProject,
  cursus: FortyTwoCursus,
  isSimulated: (projectId: number) => boolean,
): Contribution {
  let projects = 0;
  let experience = 0;
  let simulatedProjects = 0;
  let simulatedExperience = 0;

  const userProject = cursus.projects[project.id];

  for (const child of userProject?.children ?? []) {
    const c = calculateExperience(child, cursus, isSimulated);
    projects += c.projects;
    experience += c.experience;
    simulatedProjects += c.simulatedProjects;
    simulatedExperience += c.simulatedExperience;
  }

  if (userProject?.is_validated) {
    projects++;
    experience += (project.experience || 0) * ((userProject.mark || 0) / 100);
  } else if (isSimulated(project.id)) {
    // Simulated completion counts as a full pass (mark 100), tracked
    // separately so the UI can show it is not real.
    simulatedProjects++;
    simulatedExperience += project.experience || 0;
  }

  return { experience, projects, simulatedExperience, simulatedProjects };
}

export function TitleOptionRequirements({
  option,
}: { option: FortyTwoTitleOption }) {
  const { cursus } = useFortyTwoStore((state) => state);
  const simulated = useRncpSimulationStore((state) => state.simulated);
  const isSimulated = (projectId: number) => Boolean(simulated[projectId]);

  let projects = 0;
  let experience = 0;
  let simulatedProjects = 0;
  let simulatedExperience = 0;

  for (const project of Object.values(option.projects)) {
    const c = calculateExperience(project, cursus, isSimulated);

    projects += c.projects;
    experience += c.experience;
    simulatedProjects += c.simulatedProjects;
    simulatedExperience += c.simulatedExperience;
  }

  return (
    <div className="space-y-4">
      <TitleRequirement
        name={"Projects"}
        value={projects}
        simulatedValue={simulatedProjects}
        max={option.numberOfProjects}
      />

      {option.experience > 0 && (
        <TitleRequirement
          name={"Experience"}
          value={experience}
          simulatedValue={simulatedExperience}
          max={option.experience}
          unit="XP"
        />
      )}
    </div>
  );
}
