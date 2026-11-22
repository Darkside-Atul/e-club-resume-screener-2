import { ProjectEditor } from "@/components/project-editor";
import { Back } from "@/components/ui";
import { requireSession } from "@/lib/auth";

export const metadata = { title: "New project" };

export default async function NewProject() {
  await requireSession("reviewer");
  return <><Back href="/reviewer">Your projects</Back>
    <header className="page-heading"><h1>New project</h1><p>Set project requirements and a rubric before importing resumes.</p></header>
    <ProjectEditor /></>;
}
