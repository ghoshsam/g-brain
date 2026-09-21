import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { withBrain } from '@/lib/brain'
import { listProjects } from '@g-brain/core'
import { FolderGit2, Github } from 'lucide-react'
import Link from 'next/link'
import { BrainErrorCard } from './error-page'

export const dynamic = 'force-dynamic'

/**
 * A repo is written as a name, as owner/repo, or as a full URL. Only the middle
 * one can become a GitHub link without guessing an owner, so the others render
 * as plain text rather than as a link that might go nowhere.
 */
function githubHref(repo: string): string | null {
  if (repo.startsWith('https://') || repo.startsWith('http://')) return repo
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://github.com/${repo}` : null
}

export default async function ProjectsPage() {
  const result = await withBrain((ctx) => listProjects(ctx))

  if (!result.ok) {
    return <BrainErrorCard code={result.error.code} message={result.error.message} />
  }

  if (result.value.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No projects are visible to this key. A project is a folder under the projects folder, and a
        project you cannot read is not listed.
      </p>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {result.value.map((project) => (
        <Card key={project.project} className="transition-colors hover:border-ring">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderGit2 className="size-4 text-muted-foreground" />
              <Link href={`/p/${encodeURIComponent(project.project)}`} className="hover:underline">
                {project.project}
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Badge>
              {project.docCount} {project.docCount === 1 ? 'document' : 'documents'}
            </Badge>
            {project.repos?.map((repo) => {
              const href = githubHref(repo)
              return href === null ? (
                <Badge key={repo}>{repo}</Badge>
              ) : (
                <a
                  key={repo}
                  href={href}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-accent"
                >
                  <Github className="size-3" />
                  {repo}
                </a>
              )
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
