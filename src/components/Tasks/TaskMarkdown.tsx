import ReactMarkdown from 'react-markdown'
import { useState } from 'react'

function Code({ children, className }: { children?: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false)
  const code = String(children ?? '').replace(/\n$/, '')
  const block = !!className || code.includes('\n')
  if (!block) return <code>{children}</code>
  const tokens = code.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:const|let|function|return|import|from|export|if|else|async|await|class|def|true|false|null|\d+)\b)/g)
  return <span className="task-code"><button aria-label="Copy code" onClick={() => { void navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}>{copied ? 'Copied' : 'Copy'}</button><code className={className}>{tokens.map((token, index) => <span key={index} className={index % 2 ? 'task-syntax' : undefined}>{token}</span>)}</code></span>
}

export function TaskMarkdown({ content }: { content: string }) {
  return <ReactMarkdown components={{ code: Code, a: ({ href, children }) => <a href={href} onClick={event => { event.preventDefault(); if (href && /^https?:\/\//i.test(href)) void window.hydra.openExternal(href) }}>{children}</a> }}>{content}</ReactMarkdown>
}
