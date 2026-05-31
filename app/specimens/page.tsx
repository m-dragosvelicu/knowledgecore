import { notFound } from "next/navigation";
import SpecimensClient from "./SpecimensClient";

// Dev-only design-system component gallery (Slice 1). Renders every reusable
// building block in rest + hover so the kit can be sanity-checked against
// design-system/preview/ and screenshots/. Hard-404s in production so it never
// ships to users.
export default function SpecimensPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <SpecimensClient />;
}
