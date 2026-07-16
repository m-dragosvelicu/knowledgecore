import type { PathAdjusterInput, PathAdjustment } from "@/lib/services/types";

export interface PathAdjuster {
  adjust(input: PathAdjusterInput): Promise<PathAdjustment>;
}
