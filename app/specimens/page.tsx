import { notFound } from "next/navigation";
import SpecimensClient from "./SpecimensClient";

// Dev-only design-system component gallery (Slice 1); hard-404s in
// production so it never ships to users.
export default function SpecimensPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <SpecimensClient />;
}
