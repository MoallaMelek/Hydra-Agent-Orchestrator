import { useState } from 'react'
import { Callout } from '../design/components'

export interface Explanation { title: string; body: string; tone: 'bad' | 'warn' | 'info' }

/**
 * Turns an engine or provider message into plain language with what to do next.
 * The original message stays available as technical detail.
 */
export function explain(message: string, status?: string): Explanation {
  const m = message
  if (/usage or rate limit|usage limit|rate limit|quota|overloaded|not accepting work/i.test(m)) {
    return { tone: 'warn', title: 'Your AI plan has reached its limit for now', body: 'Nothing is lost. Press Resume when your limit resets, or start a new task with the other agent.' }
  }
  if (/sign in again|not logged in|invalid api key|expired/i.test(m)) {
    const cmd = /`([^`]+)`/.exec(m)?.[1]
    return { tone: 'warn', title: 'Sign in to the agent again', body: `Your sign-in has expired.${cmd ? ` Open a terminal and run "${cmd}",` : ' Sign in from a terminal,'} then press Resume.` }
  }
  if (/could not reach|network|ECONN|ENOTFOUND|tried twice/i.test(m)) {
    return { tone: 'warn', title: "Couldn't reach the AI service", body: 'Check your internet connection, then press Resume.' }
  }
  if (/could not be started|not found|is it installed/i.test(m) && !/is not installed or not on PATH/.test(m)) {
    return { tone: 'warn', title: "The agent couldn't start", body: 'Check Agents & providers to see whether it is installed and signed in, then press Resume.' }
  }
  const tool = /"([^"]+)" is not installed or not on PATH/.exec(m)?.[1]
  if (tool) return { tone: 'bad', title: `"${tool}" isn't installed on this computer`, body: `A verification command needs "${tool}". Install it, or change the command under Verification on the project page.` }
  if (/EACCES|EPERM|permission denied|access is denied/i.test(m)) {
    return { tone: 'bad', title: "Hydra wasn't allowed to access a file", body: 'Another program may be using it, or your account lacks permission. Close programs that might lock the project folder and try again.' }
  }
  if (/conflict with this task|changes that conflict/i.test(m)) {
    return { tone: 'warn', title: 'Your branch changed in a conflicting way', body: 'Nothing was applied. Reject this change and start it again from your current code, or use Keep branch and merge it yourself.' }
  }
  if (/uncommitted changes/i.test(m)) {
    return { tone: 'warn', title: 'Commit your own changes first', body: 'Your project has uncommitted changes. Hydra never overwrites your work: commit or stash them, then accept again.' }
  }
  if (/interrupted|engine (was )?(closed|stopped)|Hydra was closed/i.test(m) || status === 'paused') {
    return { tone: 'warn', title: 'Paused', body: `${m} Press Resume to continue from where it stopped.` }
  }
  if (/budget limit/i.test(m)) return { tone: 'warn', title: 'Budget limit reached', body: 'The task stopped at the cost or time limit you set. Raise the limit in a new task if you want it to go further.' }
  if (/link to a location outside/i.test(m)) return { tone: 'bad', title: 'Blocked: a link pointing outside the project', body: m }
  if (status === 'canceled') return { tone: 'info', title: 'You stopped this task', body: 'Its work so far is kept for inspection.' }
  return { tone: 'bad', title: 'Something went wrong', body: m }
}

/** A failure shown in plain language, with the original message available on request. */
export function FriendlyError({ message, status }: { message: string; status?: string }) {
  const [details, setDetails] = useState(false)
  const e = explain(message, status)
  return (
    <Callout tone={e.tone}>
      <b>{e.title}.</b> {e.body}
      {e.body !== message && (
        <>
          {' '}<button type="button" className="chat__toggle" aria-expanded={details} onClick={() => setDetails(!details)}>{details ? 'Hide details' : 'Details'}</button>
          {details && <div className="faint mono" style={{ fontSize: 12, marginTop: 6, wordBreak: 'break-word' }}>{message}</div>}
        </>
      )}
    </Callout>
  )
}
