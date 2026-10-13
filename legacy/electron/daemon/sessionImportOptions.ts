import type { AppConfig } from '@shared/types'
import type { ListSessionOptions } from '../sessions/SessionCatalog'

type SessionImportConfig = Pick<
  AppConfig,
  'sessionImportLimit' | 'sessionMaxAgeDays' | 'sessionImportProjectPrefix' | 'hiddenSessionIds'
>

export function buildSessionImportOptions(config: SessionImportConfig): ListSessionOptions {
  return {
    limit: config.sessionImportLimit > 0 ? config.sessionImportLimit : undefined,
    maxAgeDays: config.sessionMaxAgeDays > 0 ? config.sessionMaxAgeDays : undefined,
    projectPathPrefix: config.sessionImportProjectPrefix || undefined,
    hiddenSessionIds: config.hiddenSessionIds
  }
}
