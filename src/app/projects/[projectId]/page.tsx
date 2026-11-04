import Link from "next/link";
import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace/Workspace";
import { loadWorkspace } from "@/server/workspace";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await loadWorkspace(projectId);

  if (!data) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-3">
      <nav className="text-[11px] text-faint">
        <Link href="/" className="transition hover:text-accent">
          项目列表
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-muted">{data.project.name}</span>
      </nav>
      <Workspace data={data} />
    </div>
  );
}
