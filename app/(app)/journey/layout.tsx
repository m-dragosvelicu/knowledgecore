import type { ReactNode } from "react";
import Box from "@mui/material/Box";

// Journey wizard chrome. "Save & leave" is not a shared footer here — it lives
// on each step's primary forward-action row instead (components/journey/SaveAndLeave.tsx).
export default function JourneyLayout({ children }: { children: ReactNode }) {
  return <Box sx={{ position: "relative" }}>{children}</Box>;
}
