import { Fragment, type ReactNode } from 'react'

/**
 * Minimal Markdown for agent replies: headings, paragraphs, emphasis, inline and fenced
 * code, lists, tables and links. It builds React elements only (never HTML strings),
 * so text from agents or repositories cannot inject markup or scripts.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="md">{blocks(text.replace(/\r\n/g, '\n'))}</div>
}

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const token = match[0]
    const k = `${key}-${match.index}`
    if (token.startsWith('`')) out.push(<code key={k}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('**')) out.push(<strong key={k}>{inline(token.slice(2, -2), key + 1)}</strong>)
    else if (token.startsWith('*')) out.push(<em key={k}>{inline(token.slice(1, -1), key + 1)}</em>)
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!
      out.push(/^https:\/\//.test(href!) ? <a key={k} href={href} target="_blank" rel="noreferrer noopener">{label}</a> : <span key={k}>{label}</span>)
    }
    last = match.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line)
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

function blocks(text: string): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const key = `b${i}`
    if (!line.trim()) { i++; continue }
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) body.push(lines[i++]!)
      i++
      out.push(<pre key={key}><code>{body.join('\n')}</code></pre>)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = Math.min(heading[1]!.length + 2, 6)
      const Tag = `h${level}` as 'h3'
      out.push(<Tag key={key}>{inline(heading[2]!)}</Tag>)
      i++
      continue
    }
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i]!)) rows.push(cells(lines[i++]!))
      out.push(
        <div key={key} className="md-table"><table>
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
        </table></div>
      )
      continue
    }
    const listItem = /^\s*([-*+]|\d+[.)])\s+(.*)$/
    if (listItem.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (i < lines.length && listItem.test(lines[i]!)) items.push(listItem.exec(lines[i++]!)![2]!)
      const List = ordered ? 'ol' : 'ul'
      out.push(<List key={key}>{items.map((item, j) => <li key={j}>{inline(item)}</li>)}</List>)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() && !/^\s*(```|~~~|#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(lines[i]!) && !isTableRow(lines[i]!)) para.push(lines[i++]!)
    if (!para.length) para.push(lines[i++]!)
    out.push(<p key={key}>{para.map((p, j) => <Fragment key={j}>{j > 0 && ' '}{inline(p)}</Fragment>)}</p>)
  }
  return out
}
