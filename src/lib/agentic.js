// Accessors for the agentic UMD globals loaded via index.html script tag
// The bundle exposes: AgenticCore, AgenticConductor, AgenticStore, AgenticVoice, AgenticShellBrowser

export function getAgenticCore() {
  const Agentic = window.Agentic || window.AgenticCore
  if (!Agentic) throw new Error('AgenticCore not loaded — check index.html script tag')
  return typeof Agentic === 'function' ? Agentic : Agentic.Agentic || Agentic
}

export function getAgenticConductor() {
  return window.AgenticConductor
}

export function getAgenticStore() {
  return window.AgenticStore
}

export function getAgenticVoice() {
  return window.AgenticVoice
}

export function getAgenticShell() {
  return window.AgenticShellBrowser
}
