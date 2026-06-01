import type { ReactNode } from "react";
import Box from "@mui/material/Box";

// The journey wizard chrome. The "Save & leave" exit affordance is NOT a shared
// footer here anymore: per the founder's final spec it lives on each step's
// PRIMARY forward action row (Continue / Submit / "Looks good, start" / advance),
// on the side opposite the primary, with its own 1px separator line above.
// See components/journey/SaveAndLeave.tsx.
export default function JourneyLayout({ children }: { children: ReactNode }) {
  return <Box sx={{ position: "relative" }}>{children}</Box>;
}
