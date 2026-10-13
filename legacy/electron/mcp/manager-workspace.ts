import { chmodSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export function setupManagerWorkspace(baseDir: string, port: number, authToken: string): string {
  const workspaceDir = join(baseDir, 'manager-workspace')
  mkdirSync(workspaceDir, { recursive: true })

  const mcpConfig = {
    mcpServers: {
      hydra: {
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      }
    }
  }
  const configPath = join(workspaceDir, '.mcp.json')
  writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2), { encoding: 'utf8', mode: 0o600 })

  const instructions = `# Hydra Manager Agent

You are a **manager agent** with access to orchestrate other agents running inside Hydra.

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| \`hydra_list_agents\` | List all agents with their current status |
| \`hydra_create_agent\` | Create a new agent in a project directory |
| \`hydra_send_prompt\` | Send a prompt to a specific agent |
| \`hydra_get_output\` | Get recent output from an agent's terminal buffer |
| \`hydra_broadcast\` | Send the same prompt to all agents in a project |
| \`hydra_kill_agent\` | Kill a running agent |
| \`hydra_restart_agent\` | Restart an agent |

## Guidelines

- Your role is to **orchestrate** other agents, not to do implementation work yourself.
- Break complex tasks into agent-specific assignments and delegate them.
- Monitor agent outputs with \`hydra_get_output\` and adjust strategy based on progress.
- Use \`hydra_broadcast\` to coordinate agents working on the same project.
- You **cannot** create other manager agents — only regular working agents.
- When creating agents, always specify a real project directory path and a descriptive name.
- Agents retain their provider permission prompts. Never request or assume bypass/full-access mode.
`
  writeFileSync(join(workspaceDir, 'CLAUDE.md'), instructions, { encoding: 'utf8', mode: 0o600 })
  if (process.platform !== 'win32') {
    chmodSync(workspaceDir, 0o700)
    chmodSync(configPath, 0o600)
  }

  return workspaceDir
}
