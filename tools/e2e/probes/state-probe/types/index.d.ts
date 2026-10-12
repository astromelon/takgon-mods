/** /clear 전후 state 유지 여부를 보는 실험용 값. */
export type ProbeValue = string

declare module 'claude-code' {
  interface PluginState {
    'state-probe': { v: ProbeValue; ends: string[] }
  }
}
