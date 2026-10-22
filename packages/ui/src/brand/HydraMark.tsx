/**
 * Hydra mark: three agent heads in their role hues (planner, implementer, reviewer) whose
 * paths converge into one result that only you deliver.
 */
export function HydraMark({ size = 24, title = 'Hydra' }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={title} fill="none">
      <path d="M7 7c0 7 9 8 9 17M25 7c0 7-9 8-9 17M16 5v19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="7" cy="6.5" r="3" fill="var(--planner)" />
      <circle cx="16" cy="4.5" r="3" fill="var(--builder)" />
      <circle cx="25" cy="6.5" r="3" fill="var(--reviewer)" />
      <path d="M11.5 25.5 16 29.5l4.5-4" stroke="var(--you)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
