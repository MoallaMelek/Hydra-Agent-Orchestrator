import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'you'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  busy?: boolean
}

export function Button({ variant = 'default', size = 'md', icon, busy, children, className = '', disabled, ...rest }: ButtonProps) {
  const classes = ['hx-btn', variant !== 'default' && `hx-btn--${variant}`, size !== 'md' && `hx-btn--${size}`, !children && 'hx-btn--icon', className].filter(Boolean).join(' ')
  return (
    <button type="button" className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="hx-spinner" aria-hidden /> : icon}
      {children}
    </button>
  )
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'accent'

export function Badge({ tone = 'neutral', live, plain, children, title }: { tone?: Tone; live?: boolean; plain?: boolean; children: ReactNode; title?: string }) {
  const classes = ['hx-badge', tone !== 'neutral' && `hx-badge--${tone}`, live && 'hx-badge--live', plain && 'hx-badge--plain'].filter(Boolean).join(' ')
  return <span className={classes} title={title}>{children}</span>
}

export function Panel({ title, actions, children, bodyClass = 'hx-panel__body' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; bodyClass?: string }) {
  return (
    <section className="hx-panel">
      {(title || actions) && (
        <header className="hx-panel__head">
          {title && <h2 className="hx-panel__title">{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="hx-field">
      <label className="hx-field__label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="hx-field__hint">{hint}</div>}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div className="hx-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: Array<{ id: T; label: string; count?: number; icon?: ReactNode }>; onChange: (id: T) => void }) {
  return (
    <div className="hx-tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.id} role="tab" type="button" className="hx-tab" tabIndex={value === tab.id ? 0 : -1} aria-selected={value === tab.id} onClick={() => onChange(tab.id)} onKeyDown={e => {
          if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return
          e.preventDefault()
          const index = tabs.findIndex(t => t.id === value)
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
          onChange(tabs[next]!.id)
          const buttons = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
          buttons?.[next]?.focus()
        }}>
          {tab.icon}{tab.label}{tab.count !== undefined && <span className="hx-tab__count">{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Dialog({ open, title, children, footer, onClose }: { open: boolean; title: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog ref={ref} className="hx-dialog" aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      <header className="hx-dialog__head"><h3 id={titleId}>{title}</h3></header>
      <div className="hx-dialog__body">{children}</div>
      {footer && <footer className="hx-dialog__foot">{footer}</footer>}
    </dialog>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="hx-empty">
      {icon && <div className="hx-empty__icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p className="muted" style={{ maxWidth: 440 }}>{children}</p>}
      {action}
    </div>
  )
}

export function Callout({ tone = 'info', icon, children }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; icon?: ReactNode; children: ReactNode }) {
  return <div className={`hx-callout hx-callout--${tone}`} role={tone === 'bad' ? 'alert' : undefined}>{icon}<div className="grow">{children}</div></div>
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0
  const tone = ratio >= 1 ? 'bad' : ratio >= 0.8 ? 'warn' : ''
  return (
    <div className="hx-meter" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={`hx-meter__fill ${tone ? `hx-meter__fill--${tone}` : ''}`} style={{ transform: `scaleX(${ratio})` }} />
    </div>
  )
}

export const Spinner = () => <span className="hx-spinner" role="status" aria-label="Working" />
