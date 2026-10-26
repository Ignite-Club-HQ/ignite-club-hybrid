import { createContext, useContext } from "react";

export const KeptPageActivity = createContext<boolean | null>(null);
export function useKeptPageActive() { return useContext(KeptPageActivity); }