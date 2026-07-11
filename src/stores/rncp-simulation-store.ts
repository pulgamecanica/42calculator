import { createStore } from "zustand/vanilla";

export type RncpSimulationState = {
  /** Set of project ids the user has marked as "would complete". */
  simulated: Record<number, boolean>;
};

export type RncpSimulationActions = {
  toggle: (projectId: number) => void;
  set: (projectId: number, simulated: boolean) => void;
  clear: () => void;
};

export type RncpSimulationStore = RncpSimulationState & RncpSimulationActions;

export const createRncpSimulationStore = () => {
  return createStore<RncpSimulationStore>()((set) => ({
    simulated: {},

    toggle: (projectId: number) =>
      set((state) => {
        const next = { ...state.simulated };
        if (next[projectId]) {
          delete next[projectId];
        } else {
          next[projectId] = true;
        }
        return { simulated: next };
      }),

    set: (projectId: number, simulated: boolean) =>
      set((state) => {
        const next = { ...state.simulated };
        if (simulated) {
          next[projectId] = true;
        } else {
          delete next[projectId];
        }
        return { simulated: next };
      }),

    clear: () => set({ simulated: {} }),
  }));
};
