import { createContext, useContext } from "react";

interface MoodContextValue { openMood: () => void; }
const MoodCtx = createContext<MoodContextValue>({ openMood: () => {} });

export const MoodProvider = MoodCtx.Provider;
export function useMoodOpen() { return useContext(MoodCtx); }
