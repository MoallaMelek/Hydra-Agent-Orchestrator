/** Reveal within Hydra's owned scroll surface. Native scrollIntoView can also
 * scroll overflow-hidden ancestors, clipping the command frame after deep links. */
export function revealInWorkspace(target: HTMLElement | null, center = false): void {
  const main = document.querySelector<HTMLElement>('.main')
  if (!target || !main) return
  const bounds = target.getBoundingClientRect()
  const frame = main.getBoundingClientRect()
  const offset = center ? Math.max(20, (frame.height - bounds.height) / 2) : 20
  main.scrollTo({ top: Math.max(0, main.scrollTop + bounds.top - frame.top - offset), behavior: 'instant' })
  target.focus({ preventScroll: true })
}
