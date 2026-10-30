import type { CSSProperties } from 'react'
import { notebookColorValue } from '../notebookColors'
import type { Project } from './model'

const circumference = 2 * Math.PI * 6

/** Progress in the project's color; a dashed ring for planned projects. */
export default function ProjectRing({
  project,
  ratio,
  className = '',
}: {
  project: Pick<Project, 'color' | 'status'>
  ratio: number | null
  className?: string
}) {
  const planned = project.status === 'planned'
  return (
    <svg
      className={`project-ring ${planned ? 'is-planned' : ''} ${className}`}
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{ '--ring': notebookColorValue(project.color) } as CSSProperties}
    >
      <circle className="project-ring-track" cx="8" cy="8" r="6" />
      {!planned && (
        <circle
          className="project-ring-value"
          cx="8"
          cy="8"
          r="6"
          strokeDasharray={`${(ratio ?? 0) * circumference} ${circumference}`}
        />
      )}
    </svg>
  )
}
