import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'

export const useAgentStore = defineStore('agent', () => {
  const messages = ref([])
  const ai = ref(null)
  const conductor = ref(null)
  const configured = ref(false)
  const blackboard = reactive({
    currentTask: null,
    directive: null,
    completedSteps: [],
    workerLog: []
  })
  const customSkills = ref(new Map())
  const taskHistory = ref([])
  const proactiveEnabled = ref(true)
  const lastUserMessage = ref(Date.now())
  const lastProactive = ref(0)

  return {
    messages, ai, conductor, configured, blackboard,
    customSkills, taskHistory, proactiveEnabled,
    lastUserMessage, lastProactive
  }
})
