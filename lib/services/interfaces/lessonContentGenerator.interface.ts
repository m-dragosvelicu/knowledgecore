import type {
  LessonContent,
  LessonContentInput,
} from "@/lib/services/lessonContent";

export interface LessonContentGenerator {
  generate(input: LessonContentInput): Promise<LessonContent>;
}
