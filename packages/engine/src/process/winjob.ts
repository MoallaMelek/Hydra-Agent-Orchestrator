import { createRequire } from 'node:module'
import type * as Koffi from 'koffi'

/**
 * Windows Job Objects: an OS-enforced boundary around a process and every process it
 * starts, including descendants whose parent has already exited. Terminating the job
 * ends all of them; TerminateProcess cannot be ignored by the target. With
 * KILL_ON_JOB_CLOSE, the job is also terminated if Hydra itself dies.
 *
 * Loaded lazily through `koffi` (FFI to kernel32). If it cannot load, callers fall back
 * to `taskkill /T` and the limitation is reported by `jobSupport()`.
 */

const PROCESS_TERMINATE = 0x0001
const PROCESS_SET_QUOTA = 0x0100
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
const JobObjectBasicAccountingInformation = 1
const JobObjectExtendedLimitInformation = 9

type Handle = unknown
interface Kernel32 {
  CreateJobObjectW: (attributes: null, name: null) => Handle
  SetInformationJobObject: (job: Handle, infoClass: number, info: unknown, length: number) => boolean
  AssignProcessToJobObject: (job: Handle, process: Handle) => boolean
  OpenProcess: (access: number, inherit: boolean, pid: number) => Handle
  TerminateJobObject: (job: Handle, exitCode: number) => boolean
  QueryInformationJobObject: (job: Handle, infoClass: number, info: unknown, length: number, returned: null) => boolean
  CloseHandle: (handle: Handle) => boolean
  GetLastError: () => number
  GetCurrentProcess: () => Handle
  extendedSize: number
  accountingSize: number
  ExtendedLimit: unknown
  Accounting: unknown
}

let api: Kernel32 | null | undefined
let loadError: string | null = null

function kernel32(): Kernel32 | null {
  if (api !== undefined) return api
  api = null
  if (process.platform !== 'win32') { loadError = 'not Windows'; return api }
  try {
    const koffi = createRequire(import.meta.url)('koffi') as typeof Koffi
    const lib = koffi.load('kernel32.dll')
    const Basic = koffi.struct('JOBOBJECT_BASIC_LIMIT_INFORMATION', {
      PerProcessUserTimeLimit: 'int64', PerJobUserTimeLimit: 'int64', LimitFlags: 'uint32',
      MinimumWorkingSetSize: 'size_t', MaximumWorkingSetSize: 'size_t', ActiveProcessLimit: 'uint32',
      Affinity: 'uintptr_t', PriorityClass: 'uint32', SchedulingClass: 'uint32'
    })
    const Io = koffi.struct('IO_COUNTERS', {
      ReadOperationCount: 'uint64', WriteOperationCount: 'uint64', OtherOperationCount: 'uint64',
      ReadTransferCount: 'uint64', WriteTransferCount: 'uint64', OtherTransferCount: 'uint64'
    })
    const ExtendedLimit = koffi.struct('JOBOBJECT_EXTENDED_LIMIT_INFORMATION', {
      BasicLimitInformation: Basic, IoInfo: Io, ProcessMemoryLimit: 'size_t', JobMemoryLimit: 'size_t',
      PeakProcessMemoryUsed: 'size_t', PeakJobMemoryUsed: 'size_t'
    })
    const Accounting = koffi.struct('JOBOBJECT_BASIC_ACCOUNTING_INFORMATION', {
      TotalUserTime: 'int64', TotalKernelTime: 'int64', ThisPeriodTotalUserTime: 'int64', ThisPeriodTotalKernelTime: 'int64',
      TotalPageFaultCount: 'uint32', TotalProcesses: 'uint32', ActiveProcesses: 'uint32', TotalTerminatedProcesses: 'uint32'
    })
    api = {
      CreateJobObjectW: lib.func('void* __stdcall CreateJobObjectW(void *attrs, const char16_t *name)') as Kernel32['CreateJobObjectW'],
      SetInformationJobObject: lib.func('bool __stdcall SetInformationJobObject(void *job, int cls, _In_ JOBOBJECT_EXTENDED_LIMIT_INFORMATION *info, uint32 len)') as Kernel32['SetInformationJobObject'],
      AssignProcessToJobObject: lib.func('bool __stdcall AssignProcessToJobObject(void *job, void *proc)') as Kernel32['AssignProcessToJobObject'],
      OpenProcess: lib.func('void* __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)') as Kernel32['OpenProcess'],
      TerminateJobObject: lib.func('bool __stdcall TerminateJobObject(void *job, uint32 code)') as Kernel32['TerminateJobObject'],
      QueryInformationJobObject: lib.func('bool __stdcall QueryInformationJobObject(void *job, int cls, _Out_ JOBOBJECT_BASIC_ACCOUNTING_INFORMATION *info, uint32 len, void *ret)') as Kernel32['QueryInformationJobObject'],
      CloseHandle: lib.func('bool __stdcall CloseHandle(void *h)') as Kernel32['CloseHandle'],
      GetLastError: lib.func('uint32 __stdcall GetLastError()') as Kernel32['GetLastError'],
      GetCurrentProcess: lib.func('void* __stdcall GetCurrentProcess()') as Kernel32['GetCurrentProcess'],
      extendedSize: koffi.sizeof(ExtendedLimit),
      accountingSize: koffi.sizeof(Accounting),
      ExtendedLimit, Accounting
    }
  } catch (error) {
    loadError = (error as Error).message
    api = null
  }
  return api
}

/** Whether OS-enforced process cleanup is available on this machine, and why not. */
export function jobSupport(): { available: boolean; reason: string | null } {
  const k = kernel32()
  return { available: Boolean(k), reason: k ? null : loadError }
}

function emptyLimits(flags: number) {
  return {
    BasicLimitInformation: { PerProcessUserTimeLimit: 0, PerJobUserTimeLimit: 0, LimitFlags: flags, MinimumWorkingSetSize: 0, MaximumWorkingSetSize: 0, ActiveProcessLimit: 0, Affinity: 0, PriorityClass: 0, SchedulingClass: 0 },
    IoInfo: { ReadOperationCount: 0, WriteOperationCount: 0, OtherOperationCount: 0, ReadTransferCount: 0, WriteTransferCount: 0, OtherTransferCount: 0 },
    ProcessMemoryLimit: 0, JobMemoryLimit: 0, PeakProcessMemoryUsed: 0, PeakJobMemoryUsed: 0
  }
}

/** A job that holds one process tree. Closing or terminating it ends every process in it. */
export class ProcessJob {
  private handle: Handle | null

  private constructor(handle: Handle) { this.handle = handle }

  /** Creates a kill-on-close job and puts the process in it. Returns null when unavailable. */
  static adopt(pid: number): ProcessJob | null {
    const k = kernel32()
    if (!k) return null
    const handle = k.CreateJobObjectW(null, null)
    if (!handle) return null
    if (!k.SetInformationJobObject(handle, JobObjectExtendedLimitInformation, emptyLimits(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE), k.extendedSize)) { k.CloseHandle(handle); return null }
    const proc = k.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)
    if (!proc) { k.CloseHandle(handle); return null }
    const ok = k.AssignProcessToJobObject(handle, proc)
    k.CloseHandle(proc)
    if (!ok) { k.CloseHandle(handle); return null }
    return new ProcessJob(handle)
  }

  /** Number of processes still alive in the job (0 once everything has ended); -1 when it cannot be read. */
  activeProcesses(): number {
    const k = kernel32()
    // Closed: the kill-on-close job ended everything in it when its handle was released.
    if (!this.handle) return 0
    if (!k) return -1
    const info = {} as { ActiveProcesses?: number }
    // A failed query is "unknown", never "empty": cleanup must not be reported as done on a guess.
    return k.QueryInformationJobObject(this.handle, JobObjectBasicAccountingInformation, info, k.accountingSize, null) ? info.ActiveProcesses ?? -1 : -1
  }

  /** Ends every process in the job. Cannot be ignored by the processes. */
  terminate(): boolean {
    const k = kernel32()
    if (!k || !this.handle) return false
    return k.TerminateJobObject(this.handle, 1)
  }

  /** Waits until no process is left in the job; true if it emptied within the time limit. */
  async waitEmpty(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.activeProcesses() === 0) return true
      await new Promise((r) => setTimeout(r, 50))
    }
    return this.activeProcesses() === 0
  }

  /** Releases the handle. With kill-on-close this also ends anything still running. */
  close(): void {
    const k = kernel32()
    if (k && this.handle) k.CloseHandle(this.handle)
    this.handle = null
  }
}

/**
 * Puts the current process (the engine) in a kill-on-close job, so every process it
 * starts dies with it, even after a crash. Best effort; returns whether it worked.
 */
export function bindChildrenToThisProcess(): boolean {
  const k = kernel32()
  if (!k) return false
  const handle = k.CreateJobObjectW(null, null)
  if (!handle) return false
  if (!k.SetInformationJobObject(handle, JobObjectExtendedLimitInformation, emptyLimits(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE), k.extendedSize)) { k.CloseHandle(handle); return false }
  if (!k.AssignProcessToJobObject(handle, k.GetCurrentProcess())) { k.CloseHandle(handle); return false }
  // The handle is intentionally kept open for the life of the engine; the OS closes it on exit.
  return true
}
