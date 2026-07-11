"use client";

import {
  type RncpSimulationStore,
  createRncpSimulationStore,
} from "@/stores/rncp-simulation-store";
import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";

export const RncpSimulationStoreContext =
  createContext<StoreApi<RncpSimulationStore> | null>(null);

export interface RncpSimulationStoreProviderProps {
  children: ReactNode;
}

export const RncpSimulationStoreProvider = ({
  children,
}: RncpSimulationStoreProviderProps) => {
  const storeRef = useRef<StoreApi<RncpSimulationStore>>(null);
  if (!storeRef.current) {
    storeRef.current = createRncpSimulationStore();
  }

  return (
    <RncpSimulationStoreContext.Provider value={storeRef.current}>
      {children}
    </RncpSimulationStoreContext.Provider>
  );
};

export const useRncpSimulationStore = <T,>(
  selector: (store: RncpSimulationStore) => T,
): T => {
  const context = useContext(RncpSimulationStoreContext);

  if (!context) {
    throw new Error(
      "useRncpSimulationStore must be used within RncpSimulationStoreProvider",
    );
  }

  return useStore(context, selector);
};
