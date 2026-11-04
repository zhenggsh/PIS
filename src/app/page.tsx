import { ProjectList, type ProjectListItem } from "@/components/project/ProjectList";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await db.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { tasks: true } } },
  });

  const items: ProjectListItem[] = projects.map((project) => ({
    id: project.id,
    key: project.key,
    name: project.name,
    description: project.description,
    status: project.status,
    kickoffDate: project.kickoffDate,
    preAcceptDate: project.preAcceptDate,
    taskCount: project._count.tasks,
    updatedAt: project.updatedAt.toISOString(),
  }));

  return <ProjectList projects={items} />;
}
