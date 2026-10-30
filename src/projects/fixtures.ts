import { today } from './model'
import type { Project, ProjectData, Task } from './model'

/** Fictional session-only projects for the browser preview. Dates follow today. */
export function previewProjectData(now = new Date()): ProjectData {
  const shift = (days: number) => today(new Date(now.getTime() + days * 86_400_000))
  const at = now.getTime()
  const project = (
    fields: Pick<Project, 'id' | 'name' | 'status' | 'color' | 'sort'> & Partial<Project>,
  ): Project => ({
    description: '',
    startDate: null,
    endDate: null,
    completedAt: null,
    notebookId: null,
    deletedAt: null,
    created: at,
    updated: at,
    revision: 1,
    ...fields,
  })
  let sort = 0
  const task = (
    title: string,
    projectId: string | null,
    fields: Partial<Task> = {},
  ): Task => ({
    id: `preview-task-${++sort}`,
    title,
    description: '',
    status: 'todo',
    projectId,
    priority: 0,
    startDate: null,
    dueDate: null,
    completedAt: fields.status === 'done' ? at : null,
    sort,
    deletedAt: null,
    created: at,
    updated: at,
    revision: 1,
    ...fields,
  })
  const web = 'preview-project-web'
  const budget = 'preview-project-budget'
  const garden = 'preview-project-garden'
  return {
    projects: [
      project({
        id: web,
        name: 'Website relaunch',
        description: 'New marketing site, copy and launch checklist.',
        status: 'active',
        startDate: shift(-24),
        endDate: shift(29),
        color: '#428e8e',
        sort: 1,
      }),
      project({
        id: budget,
        name: 'Q4 budget review',
        status: 'active',
        startDate: shift(-10),
        endDate: shift(40),
        color: '#8b75a5',
        sort: 2,
      }),
      project({ id: garden, name: 'Garden redesign', status: 'planned', color: '#688b60', sort: 3 }),
    ],
    tasks: [
      task('Write homepage copy', web, {
        status: 'doing',
        priority: 3,
        dueDate: shift(5),
        description: 'Hero, three feature blocks and the pricing teaser.',
      }),
      task('Pick a typeface pairing', web, { status: 'doing', priority: 1, dueDate: shift(8) }),
      task('Migrate blog posts from the old CMS', web, { priority: 2, dueDate: shift(-3) }),
      task('Set up redirects for retired pages', web, { dueDate: shift(19) }),
      task('Launch announcement email', web, { priority: 2, dueDate: shift(29) }),
      task('Wireframes for homepage', web, { status: 'done' }),
      task('Collect brand assets', web, { status: 'done' }),
      task('Agree on scope', web, { status: 'done' }),
      task('Gather last year’s actuals', budget, { status: 'done' }),
      task('Draft department targets', budget, { dueDate: shift(12) }),
      task('Measure the beds', garden),
      task('Book the dentist', null, { dueDate: shift(1) }),
      task('Renew passport', null, { priority: 2 }),
    ],
  }
}
