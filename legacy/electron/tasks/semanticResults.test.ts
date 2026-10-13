import { describe, expect, it } from 'vitest'
import { consumeProviderLine, emptySemanticResult } from './semanticResults'
describe('semantic CLI results', () => {
  it('captures Codex sessions, real command evidence and semantic completion', () => {
    const result = emptySemanticResult()
    for (const event of [{type:'thread.started',thread_id:'thread-1'},{type:'item.completed',item:{type:'command_execution',command:'npm run test',exit_code:0,aggregated_output:'passed'}},{type:'item.completed',item:{type:'agent_message',text:'result'}},{type:'turn.completed'}]) consumeProviderLine('codex',JSON.stringify(event),result,'run')
    expect(result).toMatchObject({ terminal:true, failed:false, text:'result',sessionId:'thread-1' }); expect(result.evidence[0].exitCode).toBe(0)
  })
  it('does not turn malformed output or plain claims into successful completion', () => {
    const result = emptySemanticResult(); consumeProviderLine('codex','All tests passed!',result,'run'); expect(result.terminal).toBe(false)
    consumeProviderLine('codex',JSON.stringify({type:'turn.failed'}),result,'run'); expect(result.failed).toBe(true)
  })
  it('records successful Claude Read results, not model text or Write results, as file evidence', () => {
    const result = emptySemanticResult()
    consumeProviderLine('claude',JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id:'read',name:'Read',input:{file_path:'README.md'}},{type:'tool_use',id:'write',name:'Write',input:{file_path:'a.md'}}]}}),result,'run')
    consumeProviderLine('claude',JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'read',content:'actual contents'},{type:'tool_result',tool_use_id:'write',content:'written'}]}}),result,'run')
    consumeProviderLine('claude',JSON.stringify({type:'result',subtype:'success',is_error:false,result:'done',permission_denials:[]}),result,'run')
    expect(result.evidence).toHaveLength(1); expect(result.evidence[0]).toMatchObject({kind:'file',tool:'Read',command:'Read README.md'}); expect(result.terminal).toBe(true)
  })
  it('detects Claude semantic failures and permission denials even at process exit zero', () => {
    const result = emptySemanticResult(); consumeProviderLine('claude',JSON.stringify({type:'result',is_error:true,subtype:'error',permission_denials:[{}]}),result,'run')
    expect(result.failed).toBe(true); expect(result.permissionDenied).toBe(true)
  })
})
