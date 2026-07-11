"use client";

import { PlannedProjectsSync } from "@/components/planned-projects-sync";
import { useFortyTwoStore } from "@/providers/forty-two-store-provider";
import { usePlannedProjects } from "@/stores/planned-projects-store";
import type { FortyTwoTitle } from "@/types/forty-two";
import { useState } from "react";
import { TitleOptions } from "./(options)/options";
import { TitleRequirements } from "./(options)/requirements";
import { TitleSelector } from "./selector";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RotateCcw } from "lucide-react";
import { track } from "@vercel/analytics";

export default function Titles() {
  const { titles } = useFortyTwoStore((state) => state);
  const [activeTitle, _setActiveTitle] = useState<FortyTwoTitle | null>(
    titles[0] ?? null,
  );

  const setActiveTitle = (title: FortyTwoTitle | null) => {
    if (!title) {
      return;
    }

    _setActiveTitle(title);

    track("rncp-title-switched", {
      title: title?.title,
    });
  };

  if (!activeTitle) {
    return null;
  }

  return (
    <>
      <PlannedProjectsSync />

      <TitleSelector
        titles={titles}
        activeTitle={activeTitle}
        setActiveTitle={setActiveTitle}
      />

      <Separator className="my-6" />

      <div className="my-6 flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h4 className="font-semibold text-2xl leading-none tracking-tight">
            Information
          </h4>

          <p className="text-muted-foreground text-sm">
            You must validate the 'Suite' tab, one of the option tabs, and the
            requirements. Click a project to simulate completing it.{" "}
            <Link
              className="underline underline-offset-1 transition-colors hover:text-foreground"
              prefetch={false}
              href="https://meta.intra.42.fr/articles/rncp-7-certificate"
            >
              Learn more.
            </Link>
          </p>
        </div>

        <ResetSimulationButton />
      </div>

      <TitleRequirements
        title={activeTitle}
        className="my-6"
      />
      <TitleOptions title={activeTitle} />
    </>
  );
}

function ResetSimulationButton() {
  const { planned, clear } = usePlannedProjects((state) => state);
  const count = Object.keys(planned).length;

  if (count === 0) {
    return null;
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0"
      onClick={() => clear()}
    >
      <RotateCcw className="mr-2 size-4" />
      Reset ({count})
    </Button>
  );
}
