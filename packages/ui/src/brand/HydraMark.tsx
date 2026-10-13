/**
 * Hydra v2 mark, drawn for v2: three agent heads whose paths converge into one
 * verified result, like branches merging into a single approved change.
 */
export function HydraMark({ size = 24, title = 'Hydra' }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={title} fill="none">
      <path d="M7 7c0 7 9 8 9 17M25 7c0 7-9 8-9 17M16 5v19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="7" cy="6.5" r="3" fill="var(--accent)" />
      <circle cx="16" cy="4.5" r="3" fill="var(--accent)" />
      <circle cx="25" cy="6.5" r="3" fill="var(--accent)" />
      <path d="M11.5 25.5 16 29.5l4.5-4" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
