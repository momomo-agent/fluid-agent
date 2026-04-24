/* agentic.bundle.js — auto-generated 2026-04-24 */

// ═══ agentic-conductor.js ═══
(function(e,t){typeof exports==`object`&&typeof module<`u`?t(exports):typeof define==`function`&&define.amd?define([`exports`],t):(e=typeof globalThis<`u`?globalThis:e||self,t(e.AgenticConductor={}))})(this,function(e){Object.defineProperty(e,Symbol.toStringTag,{value:`Module`});function t(e={}){let t=[],n={},r=1,i=e.store||null,a=`conductor/intents`;function o(){if(i)try{i.set(a,JSON.stringify({intents:n,nextId:r}))}catch{}}async function s(){if(i)try{let e=await i.get(a);if(e){let t=typeof e==`string`?JSON.parse(e):e;n=t.intents||{},r=t.nextId||1}}catch{}}function c(e,n){for(let r of t)try{r(e,n)}catch(e){console.error(`[IntentState] listener error:`,e)}}function l(e,t={}){let i=`intent-${r++}`,a={id:i,goal:e,status:`active`,dependsOn:t.dependsOn||[],priority:t.priority??1,progress:null,artifacts:[],messages:[],createdAt:Date.now(),updatedAt:Date.now()};return n[i]=a,o(),c(`create`,a),{...a}}function u(e,t){let r=n[e];if(!r)return null;if(t.goal&&(r.goal=t.goal),t.message&&r.messages.push(t.message),t.progress&&(r.progress=t.progress),t.priority!=null&&(r.priority=t.priority),t.artifacts&&t.artifacts.length>0){let e=new Set(r.artifacts.map(e=>typeof e==`string`?e:e.path));for(let n of t.artifacts){let t=typeof n==`string`?n:n.path;e.has(t)||(r.artifacts.push(n),e.add(t))}}return r.updatedAt=Date.now(),o(),c(`update`,r),{...r}}function d(e,t){let r=n[e];return r?(r.status=t,r.updatedAt=Date.now(),o(),c(t,r),{...r}):null}function f(e){return d(e,`cancelled`)}function p(e){return d(e,`running`)}function m(e){return d(e,`done`)}function h(e){return d(e,`failed`)}function g(e){let t=n[e];return t?{...t}:null}function _(){return Object.values(n).map(e=>({...e}))}function v(){return Object.values(n).filter(e=>![`done`,`failed`,`cancelled`].includes(e.status)).map(e=>({...e}))}function y(e){return t.push(e),()=>{let n=t.indexOf(e);n>=0&&t.splice(n,1)}}function b(e={}){let t=e.includeSettled||!1,r=Object.values(n).map(e=>({...e})),i=t?r:r.filter(e=>![`done`,`failed`,`cancelled`].includes(e.status));return i.length===0?``:`Intents:\n${i.map(e=>{let t=`- [${e.status}] ${e.goal}`;if(e.progress&&(t+=` (${e.progress})`),e.dependsOn.length>0){let r=e.dependsOn.map(e=>{let t=n[e];return t?`${t.goal.slice(0,30)}:${t.status}`:`${e}:unknown`});t+=` [waiting on: ${r.join(`, `)}]`}return t}).join(`
`)}`}function x(...e){for(let t of e)n[t]&&(n[t]._reported=!0)}function S(){n={},r=1,t.length=0}return{create:l,update:u,cancel:f,running:p,done:m,fail:h,get:g,getAll:_,getActive:v,onChange:y,formatForTalker:b,reset:S,setStatus:d,markReported:x,ready:s()}}function n(e={}){let t=e.maxSlots||3,n=e.maxRetries??2,r=e.retryBaseMs||1e3,i=e.maxTurnBudget||30,a=e.maxTokenBudget||2e5,o=e.turnQuantum||10,s=1,c=[],l=new Map,u=[],d=[],f=e.store||null,p=`conductor/scheduler`;function m(e,t){for(let n of d)try{n(e,t)}catch{}}function h(){if(f)try{f.set(p,JSON.stringify({nextTaskId:s,pending:c.map(e=>({id:e.id,task:e.task,priority:e.priority,dependsOn:e.dependsOn,status:e.status,retryCount:e.retryCount||0,meta:e.meta||{},turnCount:e.turnCount||0,totalTokens:e.totalTokens||0})),slots:Array.from(l.entries()).map(([e,t])=>({slotIndex:e,id:t.id,task:t.task,priority:t.priority,status:t.status,meta:t.meta||{},turnCount:t.turnCount||0,totalTokens:t.totalTokens||0})),completed:u.slice(-20).map(e=>({id:e.id,task:e.task,status:e.status}))}))}catch{}}async function g(){if(f)try{let e=await f.get(p);if(!e)return;let t=typeof e==`string`?JSON.parse(e):e;if(s=t.nextTaskId||1,t.completed&&u.push(...t.completed),t.pending)for(let e of t.pending)e.status===`pending`&&c.push(e);if(t.slots)for(let e of t.slots)e.status===`running`&&c.push({id:e.id,task:e.task,priority:e.priority,dependsOn:[],status:`pending`,retryCount:0,meta:e.meta||{},turnCount:e.turnCount||0,totalTokens:e.totalTokens||0});c.sort((e,t)=>e.priority-t.priority),c.length>0&&v()}catch{}}function _(e,t=1,n=[],r={}){let i=e.trim().toLowerCase();if(c.some(e=>e.task.trim().toLowerCase()===i&&e.status===`pending`)||Array.from(l.values()).some(e=>e.task.trim().toLowerCase()===i&&e.status===`running`))return-1;let a=s++,o={id:a,task:e,priority:t,dependsOn:n,status:`pending`,retryCount:0,meta:r,turnCount:0,totalTokens:0};return c.push(o),c.sort((e,t)=>e.priority-t.priority),m(`enqueued`,{id:a,task:e,priority:t}),h(),v(),a}function v(){for(let e=0;e<t;e++){if(l.has(e))continue;let t=y();if(!t)break;x(e,t)}}function y(){for(let e=0;e<c.length;e++){let t=c[e];if(t.status===`pending`&&t.dependsOn.every(e=>u.some(t=>t.id===e&&t.status===`done`)))return c.splice(e,1),t}return null}let b=null;function x(e,t){let n=typeof AbortController<`u`?new AbortController:{signal:{aborted:!1},abort(){this.signal.aborted=!0}};t.status=`running`,t.abort=n,t.schedulerSlot=e,t.turnCount=t.turnCount||0,t.totalTokens=t.totalTokens||0,l.set(e,t),h(),m(`started`,{id:t.id,task:t.task,slot:e}),b&&b(t.task,n,{taskId:t.id,workerId:t.meta?.workerId,priority:t.priority,resume:t.meta?.resume||!1,turnCount:t.turnCount,totalTokens:t.totalTokens}).then(n=>S(e,t,`done`,n)).catch(r=>{n.signal.aborted?S(e,t,`aborted`):C(e,t,r)})}function S(e,t,n,r){l.delete(e),t.status=n,u.push({id:t.id,task:t.task,status:n,result:r}),u.length>50&&u.shift(),m(`finished`,{id:t.id,task:t.task,status:n,result:r}),h(),v()}function C(e,t,i){t.retryCount=(t.retryCount||0)+1,t.retryCount<=n?(l.delete(e),t.status=`pending`,c.push(t),m(`retry`,{id:t.id,attempt:t.retryCount}),h(),setTimeout(()=>v(),r*2**(t.retryCount-1))):S(e,t,`error`,{error:i?.message||String(i)})}function w(e,t={}){let n=null,r=null;for(let[t,i]of l)if(i.meta?.workerId===e||i.id===e){n=t,r=i;break}return r?(r.turnCount=(r.turnCount||0)+1,r.totalTokens=(r.totalTokens||0)+(t.tokens||0),h(),r.totalTokens>=a?(m(`budget`,{id:r.id,type:`tokens`,used:r.totalTokens,limit:a}),{action:`suspend`,reason:`Token budget exceeded (${r.totalTokens})`,final:!0}):r.turnCount>=i?(m(`budget`,{id:r.id,type:`turns`,used:r.turnCount,limit:i}),{action:`suspend`,reason:`Turn budget exceeded (${r.turnCount})`,final:!0}):c.some(e=>e.status===`pending`&&e.priority<r.priority)&&r.turnCount>=o?(T(n,r,`Higher priority task waiting`),{action:`suspend`,reason:`Higher priority task waiting`}):c.filter(e=>e.status===`pending`).length>0&&r.turnCount>0&&r.turnCount%o===0?(T(n,r,`Quantum expired (${o} turns)`),{action:`suspend`,reason:`Quantum expired (${o} turns)`}):{action:`continue`}):{action:`continue`}}function T(e,t,n){l.delete(e),t.status=`suspended`,t.meta=t.meta||{},t.meta.resume=!0,t.meta.suspendedAt=Date.now(),t.meta.suspendReason=n,c.unshift(t),m(`suspended`,{id:t.id,workerId:t.meta?.workerId,reason:n}),h(),v()}function E(e){let t=c.findIndex(t=>t.status===`suspended`&&(t.meta?.workerId===e||t.id===e));return t<0?!1:(c[t].status=`pending`,h(),v(),!0)}function D(){return c.filter(e=>e.status===`suspended`).map(e=>({id:e.id,task:e.task,workerId:e.meta?.workerId,turnCount:e.turnCount,totalTokens:e.totalTokens,suspendedAt:e.meta?.suspendedAt,reason:e.meta?.suspendReason}))}function O(e){for(let[t,n]of l)if(n.meta?.workerId===e||n.id===e)return{slotIndex:t,turnCount:n.turnCount||0,totalTokens:n.totalTokens||0,priority:n.priority};return null}function k(e,t){for(let[,n]of l)if(n.id===e)return n.steerInstruction=t,!0;return!1}function A(e){for(let[t,n]of l)if(n.meta?.workerId===e||n.id===e)return n.abort&&n.abort.abort(),S(t,n,`aborted`),!0;let t=c.findIndex(t=>t.meta?.workerId===e||t.id===e);return t>=0?(c.splice(t,1),h(),!0):!1}function j(){return{pending:c.map(e=>({id:e.id,task:e.task,priority:e.priority,status:e.status,turnCount:e.turnCount,totalTokens:e.totalTokens})),slots:Array.from(l.entries()).map(([e,t])=>({slot:e,id:t.id,task:t.task,priority:t.priority,turnCount:t.turnCount,totalTokens:t.totalTokens})),completed:u.slice(-10)}}function M(){return l.size===0&&c.length===0}function N(e){return d.push(e),()=>{let t=d.indexOf(e);t>=0&&d.splice(t,1)}}function P(e){b=e}function F(){for(let[,e]of l)e.abort&&e.abort.abort();l.clear(),c.length=0,u.length=0,s=1,d.length=0,b=null}return{enqueue:_,schedule:v,steer:k,abort:A,turnCompleted:w,resumeWorker:E,getSuspended:D,getSlotStats:O,getState:j,isIdle:M,on:N,setOnStart:P,reset:F,ready:g(),MAX_SLOTS:t,MAX_TURN_BUDGET:i,MAX_TOKEN_BUDGET:a,TURN_QUANTUM:o}}function r(e={}){let t=e.intentState,n=e.scheduler,r=e.ai||null,i=e.mode||`llm`,a=new Map,o=new Map,s=new Map,c=new Map,l=[],u=e.maxTurns||30,d=e.stallThreshold||3,f=1,p=e.store||null,m=`conductor/dispatcher`,h=[];function g(e,t){for(let n of h)try{n(e,t)}catch{}}function _(e,t,n){let r={ts:Date.now(),workerId:e,action:t,detail:n};l.push(r),l.length>50&&l.shift()}function v(){if(p)try{let e={};for(let[t,n]of a)e[t]={...n},delete e[t].abort;p.set(m,JSON.stringify({workers:e,nextWorkerId:f}))}catch{}}async function y(){if(p)try{let e=await p.get(m);if(!e)return;let t=typeof e==`string`?JSON.parse(e):e;if(f=t.nextWorkerId||1,t.workers)for(let[e,n]of Object.entries(t.workers))n.status===`running`&&(n.status=`suspended`),a.set(Number(e)||e,n)}catch{}}function b(e,t){i===`llm`?S(e,t).catch(()=>{x(e,t)}):x(e,t)}function x(e,r){if(e===`create`&&(r.dependsOn||[]).every(e=>{let n=t.get(e);return n&&n.status===`done`})&&C(r),e===`done`){let e=t.getActive().filter(e=>e.status===`active`&&e.dependsOn.includes(r.id));for(let n of e)n.dependsOn.every(e=>{let n=t.get(e);return n&&n.status===`done`})&&C(n)}if(e===`failed`){let e=t.getActive().filter(e=>e.dependsOn.includes(r.id));for(let n of e)t.fail(n.id)}if(e===`cancelled`){let e=s.get(r.id);e!=null&&(n.abort(e),a.delete(e),s.delete(r.id),c.delete(e),v())}if(e===`update`){let e=s.get(r.id);if(e!=null){let t=a.get(e);t&&r.messages.length>0&&(t.steerInstruction=r.messages[r.messages.length-1],v())}}}async function S(e,i){if(!r){x(e,i);return}if(e===`create`||e===`done`||e===`update`){let o=`You are a task dispatcher. Given the current intent state, decide what operations to perform.\n\nCurrent state:\n${t.formatForTalker()}\n\nEvent: ${e} on "${i.goal}" (${i.id})\n\nRespond with a JSON array of operations:\n- {"op":"spawn","intentId":"...","task":"...","priority":N}\n- {"op":"cancel","workerId":"..."}\n- {"op":"steer","workerId":"...","instruction":"..."}\n- {"op":"merge","intentIds":["..."],"mergedGoal":"..."}\n- [] for no action\n\nOnly JSON, no explanation.`;try{let e=await r.chat([{role:`user`,content:o}]),i=(e.answer||e.content||e.text||``).match(/\[[\s\S]*\]/);if(i){let e=JSON.parse(i[0]);for(let r of e)if(r.op===`spawn`){let e=t.get(r.intentId);e&&C(e,r.priority)}else if(r.op===`cancel`&&r.workerId)n.abort(r.workerId);else if(r.op===`steer`&&r.workerId){let e=a.get(Number(r.workerId));e&&(e.steerInstruction=r.instruction)}else if(r.op===`merge`&&r.intentIds){let[e,...n]=r.intentIds;for(let e of n)t.cancel(e);r.mergedGoal&&t.update(e,{goal:r.mergedGoal})}}}catch{x(e,i)}}else x(e,i)}function C(e,r){let i=f++;t.running(e.id);let o=e.goal;if(e.dependsOn&&e.dependsOn.length>0){let n=e.dependsOn.map(e=>{let n=t.get(e);if(!n)return null;let r=[`Completed: "${n.goal}"`];return n.progress&&r.push(`Result: ${n.progress}`),n.artifacts.length>0&&r.push(`Files: ${n.artifacts.join(`, `)}`),r.join(` | `)}).filter(Boolean);n.length>0&&(o+=`\n\nContext from dependencies:\n${n.join(`
`)}`)}let l={id:i,intentId:e.id,task:o,status:`running`,steps:[],turnCount:0,totalTokens:0,toolCallCount:0,stallCount:0,createdAt:Date.now()};a.set(i,l),s.set(e.id,i),c.set(i,e.id),v(),_(i,`spawn`,`Intent ${e.id}: ${e.goal.slice(0,60)}`),g(`spawn`,{workerId:i,intentId:e.id,task:o,priority:r??e.priority}),n.enqueue(o,r??e.priority,[],{workerId:i})}function w(e){let t=a.get(e);if(!t)return{action:`continue`};if(t.turnCount=(t.turnCount||0)+1,t.turnCount>u)return _(e,`abort`,`Max turns (${u}) exceeded`),{action:`abort`,reason:`Maximum turns (${u}) reached`};if(t.steerInstruction){let e=t.steerInstruction;return t.steerInstruction=null,v(),{action:`steer`,instruction:e}}return{action:`continue`}}function T(e,r={}){let i=a.get(e);if(!i)return{action:`continue`};let s=r.usage?(r.usage.input_tokens||0)+(r.usage.output_tokens||0):r.tokens||0;if(s&&(i.totalTokens=(i.totalTokens||0)+s),r.toolCalls&&(i.toolCallCount=(i.toolCallCount||0)+r.toolCalls.length),r.messages&&o.set(e,r.messages.slice(-20)),r.toolCalls?.length>0&&(i.lastTool=r.toolCalls[r.toolCalls.length-1].name),i.steps.length>0&&r.toolCalls?.length>0){let e=new Set([`plan_steps`,`done`,`update_progress`]);if(r.toolCalls.filter(t=>!e.has(t.name)).length>0){let e=i.steps.findIndex(e=>e.status!==`done`);e>=0&&(i.steps[e].status=`done`)}}r.noProgress?(i.stallCount=(i.stallCount||0)+1,i.stallCount>=d&&_(e,`stall`,`Stalled ${i.stallCount} turns`)):i.stallCount=0,v();let l=c.get(e);if(l){let e={};i.steps.length>0&&(e.progress=`${i.steps.filter(e=>e.status===`done`).length}/${i.steps.length} steps`),r.progress&&(e.progress=r.progress),r.artifacts?.length>0&&(e.artifacts=r.artifacts),(e.progress||e.artifacts)&&t.update(l,e)}let u=n.turnCompleted(e,{tokens:s});return u.action===`suspend`?(i.status=`suspended`,_(e,`suspend`,u.reason),v(),{action:`suspend`,reason:u.reason,final:!!u.final}):{action:`continue`}}function E(e,r={}){let i=c.get(e),l=o.get(e)||[];i&&(r.summary&&t.update(i,{progress:r.summary}),t.done(i)),a.delete(e),o.delete(e),s.delete(i),c.delete(e),_(e,`done`,r.summary||`completed`),g(`done`,{workerId:e,intentId:i,result:r,messages:l}),v(),n.abort(e),O()}function D(e,r){let i=c.get(e);i&&t.fail(i),a.delete(e),o.delete(e),s.delete(i),c.delete(e),_(e,`fail`,r||`unknown error`),g(`fail`,{workerId:e,intentId:i,error:r}),v(),n.abort(e),O()}function O(){let e=n.getSuspended();for(let t of e)n.resumeWorker(t.workerId||t.id)}function k(e){let t=a.get(e);return!t||t.status!==`suspended`?!1:(t.status=`running`,v(),_(e,`resume`,`Resumed worker ${e}`),g(`resume`,{workerId:e}),n.resumeWorker(e))}function A(){return n.getSuspended()}function j(e){return a.has(e)?{...a.get(e)}:null}function M(){return Array.from(a.values()).map(e=>({...e}))}function N(e){return o.get(e)||[]}function P(){return[...l]}function F(e={}){let t=e.maxMessages||10,n=e.maxChars||500,r=[];for(let[e,i]of a){if(i.status!==`running`&&i.status!==`suspended`)continue;let a=o.get(e)||[];if(a.length===0){r.push(`Worker #${e} "${i.task.slice(0,50)}": ${i.status}, turn ${i.turnCount||0}${i.lastTool?`, last tool: `+i.lastTool:``}`);continue}let s=a.slice(-t).map(e=>{let t=e.role===`assistant`?`Worker`:e.role===`tool`?`ToolResult`:`System`,r=e.role===`tool`?n:Math.floor(n*.6),i=typeof e.content==`string`?e.content:JSON.stringify(e.content);return`  [${t}] ${i.length>r?i.slice(0,r)+`...`:i}`}).join(`
`);r.push(`Worker #${e} "${i.task.slice(0,50)}" (turn ${i.turnCount||0}):\n${s}`)}return r.length>0?r.join(`

`):``}function I(e,t){let n=a.get(e);return n?(n.steps=t.map(e=>({text:e,status:`pending`})),v(),g(`plan`,{workerId:e,steps:n.steps}),n.steps.map(e=>({...e}))):null}function L(e){let t=a.get(e);return t?t.steps.map(e=>({...e})):[]}function R(e,t){let n=a.get(e);return!n||!n.steps[t]?!1:(n.steps[t].status=`done`,v(),!0)}function z(e){i=e}function B(e){return h.push(e),()=>{let t=h.indexOf(e);t>=0&&h.splice(t,1)}}function V(){a.clear(),o.clear(),s.clear(),c.clear(),l.length=0,f=1,h.length=0}let H=y();return t.onChange(b),{beforeTurn:w,afterTurn:T,workerCompleted:E,workerFailed:D,resumeWorker:k,getSuspended:A,planSteps:I,getSteps:L,advanceStep:R,getWorker:j,getWorkers:M,getWorkerMessages:N,getDecisionLog:P,formatWorkerContext:F,setMode:z,on:B,reset:V,ready:H}}function i(){let e=new Map;return{get:t=>Promise.resolve(e.get(t)??null),set:(t,n)=>(e.set(t,n),Promise.resolve()),delete:t=>(e.delete(t),Promise.resolve()),keys:()=>Promise.resolve([...e.keys()]),has:t=>Promise.resolve(e.has(t)),clear:()=>(e.clear(),Promise.resolve())}}var a=`You are a task-aware AI assistant. When the user asks you to do things, you can:
1. Reply directly for simple questions
2. Create intents for tasks that need background work

When creating intents, output a JSON block:
\`\`\`intents
[{"action":"create","goal":"...","dependsOn":[],"priority":1},
 {"action":"update","id":"...","message":"..."},
 {"action":"cancel","id":"..."}]
\`\`\`

Rules:
- Simple questions → just answer, no intents
- Tasks needing tools/time → create intents
- Sequential tasks → use dependsOn with the ID of the prerequisite
- Always include a natural language reply before/after the intents block`,o=`You are a task-aware AI assistant. When the user asks you to do things, you can:
1. Reply directly for simple questions
2. Use the intent tools to dispatch background work

Rules:
- Simple questions → just answer, no tool calls
- Tasks needing tools/time → call create_intent for each task
- Sequential tasks → use dependsOn with the ID of the prerequisite intent
- You may call multiple intent tools in a single turn
- Always include a natural language reply alongside any tool calls`,s=[{name:`create_intent`,description:`Create a background task intent. Returns the created intent with its ID.`,parameters:{type:`object`,properties:{goal:{type:`string`,description:`What the worker should accomplish`},dependsOn:{type:`array`,items:{type:`string`},description:`IDs of intents that must complete first`},priority:{type:`number`,description:`Priority (1=normal, higher=more urgent)`}},required:[`goal`]}},{name:`update_intent`,description:`Send a message or update the goal of an existing intent.`,parameters:{type:`object`,properties:{id:{type:`string`,description:`Intent ID to update`},message:{type:`string`,description:`Message to send to the worker`},goal:{type:`string`,description:`Updated goal`}},required:[`id`]}},{name:`cancel_intent`,description:`Cancel an active intent.`,parameters:{type:`object`,properties:{id:{type:`string`,description:`Intent ID to cancel`}},required:[`id`]}}];function c(e){return!e||e.length===0?``:`\n## Your Capabilities\nYou can do these things (via background workers):\n${e.map(e=>`- ${e.name}: ${e.description||`(no description)`}`).join(`
`)}`}function l(e={}){let{ai:l,tools:u=[],systemPrompt:d=``,formatContext:f=null,strategy:p=`dispatch`,store:m=null,maxSlots:h=3,maxTurnBudget:g=30,maxTokenBudget:_=2e5,turnQuantum:v=10,dispatchMode:y=`llm`,planMode:b=!0,onWorkerStart:x=null,personality:S=``,talkerDirectives:C=``,workerDirectives:w=``,intentMode:T=`parse`}=e;if(!l)throw Error(`ai instance is required`);if(p===`single`){let e=[];return{async*chat(t,n={}){e.push({role:`user`,content:t});let r={system:d+(f?`

`+f():``)||void 0,tools:n.tools||u,...n},i=``;for await(let t of l.chat(e,r))t.type===`text_delta`||t.type===`text`?(i+=t.text||``,yield{type:`text`,text:t.text||``}):t.type===`done`?(i=t.answer||i,yield{type:`done`,reply:i,intents:[],usage:t.usage}):yield t;e.push({role:`assistant`,content:i})},getState(){return{strategy:`single`,messages:e.length}},getIntents(){return[]},cancel(){},on(){return()=>{}},destroy(){e.length=0}}}let E=m||i(),D=t({store:E}),O=n({store:E,maxSlots:h,maxTurnBudget:g,maxTokenBudget:_,turnQuantum:v}),k=r({intentState:D,scheduler:O,ai:l,mode:y,store:E}),A=[],j=[];function M(e,t){for(let n of A)try{n(e,t)}catch{}}O.setOnStart(async(e,t,n)=>{await Promise.all([D.ready,O.ready,k.ready]);let r=n.workerId,i=b?[{name:`plan_steps`,description:`Set your execution plan. Call this first before doing any work.`,parameters:{type:`object`,properties:{planned:{type:`array`,items:{type:`string`},description:`List of step descriptions`}},required:[`planned`]},execute:({planned:e})=>!Array.isArray(e)||!e.length?{error:`planned must be non-empty array of strings`}:{success:!0,steps:k.planSteps(r,e).map(e=>e.text)}},{name:`done`,description:`Signal task completion with a summary.`,parameters:{type:`object`,properties:{summary:{type:`string`,description:`Brief summary of what was accomplished`}},required:[`summary`]},execute:({summary:e})=>(k.workerCompleted(r,{summary:e}),{done:!0,summary:e})}]:[];if(x)return x(e,t,{...n,tools:[...i,...u],...i.length>0?{metaTools:i}:{},...b?{steps:()=>k.getSteps(r)}:{},beforeTurn:()=>k.beforeTurn(r),afterTurn:e=>k.afterTurn(r,e)});throw Error(`onWorkerStart not provided — cannot execute worker`)}),k.on((e,t)=>M(`dispatcher.${e}`,t)),O.on((e,t)=>M(`scheduler.${e}`,t));async function*N(e,t={}){j.push({role:`user`,content:e});let n=``;S&&(n+=S+`

`),d&&(n+=d+`

`),n+=C||(T===`tools`?o:a),n+=c(u),f&&(n+=`

`+f());let r=D.formatForTalker();r&&(n+=`

`+r);let i=k.formatWorkerContext();i&&(n+=`

## Worker Activity
`+i);let p=T===`tools`?[...s,...t.tools||[]]:t.tools,m={system:n,...t};p&&(m.tools=p);let h=``,g=[],_;for await(let e of l.chat(j,m))if((e.type===`text_delta`||e.type===`text`)&&e.text)h+=e.text,yield{type:`text`,text:e.text};else if(e.type===`tool_use`)g.push(e.tool||{id:e.id,name:e.name,input:e.input}),yield e;else if(e.type===`tool_result`)yield e;else if(e.type===`done`){if(h=e.answer||h,_=e.usage,e.tool_calls?.length)for(let t of e.tool_calls)g.some(e=>e.id===t.id)||g.push(t)}else yield e;let v=[],y=h;if(T===`tools`){let e=[];for(let t of g){let n=t.input||t.arguments||{};if(t.name===`create_intent`){let r=D.create(n.goal,{dependsOn:n.dependsOn||[],priority:n.priority??1});v.push(r),e.push({id:t.id,result:JSON.stringify({created:!0,intentId:r.id,goal:r.goal})})}else t.name===`update_intent`?(D.update(n.id,{message:n.message,goal:n.goal}),e.push({id:t.id,result:JSON.stringify({updated:!0,id:n.id})})):t.name===`cancel_intent`&&(D.cancel(n.id),e.push({id:t.id,result:JSON.stringify({cancelled:!0,id:n.id})}))}if(g.length>0){j.push({role:`assistant`,content:h,tool_calls:g});for(let t of e)j.push({role:`tool`,tool_call_id:t.id,content:t.result})}else j.push({role:`assistant`,content:h})}else{j.push({role:`assistant`,content:h});let e=P(h);for(let t of e)t.action===`create`?v.push(D.create(t.goal,{dependsOn:t.dependsOn||[],priority:t.priority??1})):t.action===`update`&&t.id?D.update(t.id,{message:t.message,goal:t.goal}):t.action===`cancel`&&t.id&&D.cancel(t.id);y=h.replace(/```intents[\s\S]*?```/g,``).trim()}M(`chat`,{input:e,reply:y,intents:v}),yield{type:`done`,reply:y,intents:v,usage:_}}function P(e){let t=e.match(/```intents\s*([\s\S]*?)```/);if(!t)return[];try{return JSON.parse(t[1])}catch{return[]}}function F(){return{strategy:`dispatch`,intents:D.getAll(),workers:k.getWorkers(),suspended:k.getSuspended(),scheduler:O.getState(),decisionLog:k.getDecisionLog()}}function I(e){return A.push(e),()=>{let t=A.indexOf(e);t>=0&&A.splice(t,1)}}function L(){D.reset(),k.reset(),O.reset(),j.length=0,A.length=0}return{chat:N,createIntent:(e,t)=>D.create(e,t),cancelIntent:e=>D.cancel(e),updateIntent:(e,t)=>D.update(e,t),completeWorker:(e,t)=>k.workerCompleted(e,t),failWorker:(e,t)=>k.workerFailed(e,t),resumeWorker:e=>k.resumeWorker(e),getSuspended:()=>k.getSuspended(),beforeTurn:e=>k.beforeTurn(e),afterTurn:(e,t)=>k.afterTurn(e,t),planSteps:(e,t)=>k.planSteps(e,t),getSteps:e=>k.getSteps(e),advanceStep:(e,t)=>k.advanceStep(e,t),getWorkerContext:e=>e==null?k.formatWorkerContext():k.getWorkerMessages(e),buildWorkerSystem:()=>{let e=``;return S&&(e+=S+`

`),e+=w||`You are the execution engine. Execute the given task using tools.
CRITICAL: You MUST use tools to complete tasks. NEVER answer with just text.`,e},getState:F,getIntents:()=>D.getAll(),on:I,destroy:L,_intentState:D,_scheduler:O,_dispatcher:k}}e.createConductor=l,e.createDispatcher=r,e.createIntentState=t,e.createScheduler=n,e.memoryStore=i});

// ═══ agentic-core.js ═══
"use strict";(function(e,t){typeof exports==`object`&&typeof module<`u`?t(exports):typeof define==`function`&&define.amd?define([`exports`],t):(e=typeof globalThis<`u`?globalThis:e||self,t(e.AgenticCore={}))})(this,function(e){Object.defineProperty(e,Symbol.toStringTag,{value:`Module`});var t=((e,t)=>()=>(t||(e((t={exports:{}}).exports,t),e=null),t.exports))(((e,t)=>{t.exports={}})),n=10,r=20,i=30,a=30,o=`When you need to use tools, call them BEFORE writing your text response. This allows parallel execution while you compose your answer.`;function s(e){let t=0;for(let n=0;n<e.length;n++){let r=e.charCodeAt(n);t=(t<<5)-t+r,t&=t}return Math.abs(t).toString(16)}function c(e){return typeof e!=`object`||!e?JSON.stringify(e):Array.isArray(e)?`[${e.map(c).join(`,`)}]`:`{${Object.keys(e).sort().map(t=>`${JSON.stringify(t)}:${c(e[t])}`).join(`,`)}}`}function l(e,t){return`${e}:${s(c(t))}`}function u(e,t,n,r){if(r!==void 0)return`error:${s(String(r))}`;if(n===void 0)return;let i=``;n&&typeof n==`object`&&Array.isArray(n.content)&&(i=n.content.filter(e=>e&&typeof e.type==`string`&&typeof e.text==`string`).map(e=>e.text).join(`
`).trim());let a=n&&typeof n==`object`&&n.details||{};if(d(e,t)&&typeof t==`object`&&t){let e=t.action;if(e===`poll`)return s(c({action:e,status:a.status,exitCode:a.exitCode??null,exitSignal:a.exitSignal??null,aggregated:a.aggregated??null,text:i}));if(e===`log`)return s(c({action:e,status:a.status,totalLines:a.totalLines??null,totalChars:a.totalChars??null,truncated:a.truncated??null,exitCode:a.exitCode??null,exitSignal:a.exitSignal??null,text:i}))}return s(c({details:a,text:i}))}function d(e,t){return e===`command_status`?!0:e!==`process`||typeof t!=`object`||!t?!1:t.action===`poll`||t.action===`log`}function f(e,t,n){let r=0,i;for(let a=e.length-1;a>=0;a--){let o=e[a];if(!(!o||o.toolName!==t||o.argsHash!==n)&&!(typeof o.resultHash!=`string`||!o.resultHash)){if(!i){i=o.resultHash,r=1;continue}if(o.resultHash!==i)break;r++}}return{count:r,latestResultHash:i}}function p(e,t){let n=e[e.length-1];if(!n)return{count:0,noProgressEvidence:!1};let r,i;for(let t=e.length-2;t>=0;t--){let a=e[t];if(a&&a.argsHash!==n.argsHash){r=a.argsHash,i=a.toolName;break}}if(!r||!i)return{count:0,noProgressEvidence:!1};let a=0;for(let t=e.length-1;t>=0;t--){let i=e[t];if(!i)continue;let o=a%2==0?n.argsHash:r;if(i.argsHash!==o)break;a++}if(a<2||t!==r)return{count:0,noProgressEvidence:!1};let o=Math.max(0,e.length-a),s,c,l=!0;for(let t=o;t<e.length;t++){let i=e[t];if(!i||!i.resultHash){l=!1;break}if(i.argsHash===n.argsHash){if(!s)s=i.resultHash;else if(s!==i.resultHash){l=!1;break}}else if(i.argsHash===r){if(!c)c=i.resultHash;else if(c!==i.resultHash){l=!1;break}}else{l=!1;break}}return(!s||!c)&&(l=!1),{count:a+1,pairedToolName:n.toolName,pairedSignature:n.argsHash,noProgressEvidence:l}}function m(e,t,a){let o=e.toolCallHistory||[],s=l(t,a),c=f(o,t,s).count,u=d(t,a),m=p(o,s);if(c>=i)return{stuck:!0,level:`critical`,detector:`global_circuit_breaker`,count:c,message:`CRITICAL: ${t} has repeated identical no-progress outcomes ${c} times. Session execution blocked by global circuit breaker to prevent runaway loops.`};if(u&&c>=r)return{stuck:!0,level:`critical`,detector:`known_poll_no_progress`,count:c,message:`CRITICAL: Called ${t} with identical arguments and no progress ${c} times. This appears to be a stuck polling loop. Session execution blocked to prevent resource waste.`};if(u&&c>=n)return{stuck:!0,level:`warning`,detector:`known_poll_no_progress`,count:c,message:`WARNING: You have called ${t} ${c} times with identical arguments and no progress. Stop polling and either (1) increase wait time between checks, or (2) report the task as failed if the process is stuck.`};if(m.count>=r&&m.noProgressEvidence)return{stuck:!0,level:`critical`,detector:`ping_pong`,count:m.count,message:`CRITICAL: You are alternating between repeated tool-call patterns (${m.count} consecutive calls) with no progress. This appears to be a stuck ping-pong loop. Session execution blocked to prevent resource waste.`,pairedToolName:m.pairedToolName};if(m.count>=n)return{stuck:!0,level:`warning`,detector:`ping_pong`,count:m.count,message:`WARNING: You are alternating between repeated tool-call patterns (${m.count} consecutive calls). This looks like a ping-pong loop; stop retrying and report the task as failed.`,pairedToolName:m.pairedToolName};let h=o.filter(e=>e.toolName===t&&e.argsHash===s).length;return!u&&h>=n?{stuck:!0,level:`warning`,detector:`generic_repeat`,count:h,message:`WARNING: You have called ${t} ${h} times with identical arguments. If this is not making progress, stop retrying and report the task as failed.`}:{stuck:!1}}function h(e,t,n){e.toolCallHistory||=[],e.toolCallHistory.push({toolName:t,argsHash:l(t,n),timestamp:Date.now()}),e.toolCallHistory.length>a&&e.toolCallHistory.shift()}function g(e,t,n,r,i){e.toolCallHistory||=[];let o=l(t,n),s=u(t,n,r,i);if(!s)return;let c=!1;for(let n=e.toolCallHistory.length-1;n>=0;n--){let r=e.toolCallHistory[n];if(!(!r||r.toolName!==t||r.argsHash!==o)&&r.resultHash===void 0){r.resultHash=s,c=!0;break}}c||e.toolCallHistory.push({toolName:t,argsHash:o,resultHash:s,timestamp:Date.now()}),e.toolCallHistory.length>a&&e.toolCallHistory.splice(0,e.toolCallHistory.length-a)}function _(e){let t=(e&&typeof e==`object`?e.message||``:String(e)).toLowerCase(),n=e&&e.status?e.status:0;return n===401||n===403||/unauthorized|forbidden|invalid.*api.?key|authentication/i.test(t)?{category:`auth`,retryable:!1}:n===402||/billing|payment|quota exceeded|insufficient.?funds/i.test(t)?{category:`billing`,retryable:!1}:n===429||/rate.?limit|too many requests/i.test(t)?{category:`rate_limit`,retryable:!0}:/context.?length|token.?limit|maximum.?context|too.?long/i.test(t)?{category:`context_overflow`,retryable:!1}:n>=500||n===529||/server.?error|internal.?error|bad.?gateway|service.?unavailable/i.test(t)?{category:`server`,retryable:!0}:/network|econnrefused|econnreset|etimedout|fetch.?failed|dns|socket/i.test(t)?{category:`network`,retryable:!0}:{category:`unknown`,retryable:!1}}var v=200;function y(e,t,n){return typeof n==`function`?(async()=>{let r=``,i=0,a=[];for await(let o of T(e,t))o.type===`text_delta`?n(`token`,{text:o.text}):o.type===`tool_use`?n(`tool`,{name:o.name,input:o.input}):o.type===`warning`?n(`warning`,{level:o.level,message:o.message}):n(o.type,o),o.type===`done`&&(r=o.answer,i=o.rounds,a=o.messages||[]);return{answer:r,rounds:i,messages:a}})():T(e,t)}var b=new Map;function x(e,t){b.set(e,t)}function S(e){b.delete(e)}async function C(e){let{messages:t,tools:n,model:r,baseUrl:i,apiKey:a,proxyUrl:o,stream:s,system:c,provider:l,signal:u,providers:d}=e,f=d&&d.length?d:[{provider:l,apiKey:a,baseUrl:i,model:r,proxyUrl:o}],p;for(let d=0;d<f.length;d++){let m=f[d],h=m.provider||l,g=b.get(h)||(h===`anthropic`?E:D);try{return await g({messages:t,tools:n,model:m.model||r,baseUrl:m.baseUrl||i,apiKey:m.apiKey||a,proxyUrl:m.proxyUrl||o,stream:s,emit:function(){},system:c,signal:u,onToolReady:e.onToolReady})}catch(e){if(p=e,d<f.length-1)continue;throw e}}throw p}async function*w(e){let{messages:t,tools:n,model:r,baseUrl:i,apiKey:a,proxyUrl:o,system:s,provider:c,signal:l,providers:u}=e,d=u&&u.length?u:[{provider:c,apiKey:a,baseUrl:i,model:r,proxyUrl:o}],f;for(let e=0;e<d.length;e++){let u=d[e],p=u.provider||c,m=u.model||r,h=u.baseUrl||i,g=u.apiKey||a,_=u.proxyUrl||o,v=b.get(p);if(v)try{let e=v({messages:t,tools:n,model:m,baseUrl:h,apiKey:g,proxyUrl:_,stream:!0,emit:function(){},system:s,signal:l});if(e&&typeof e[Symbol.asyncIterator]==`function`){let t=``,n=[];for await(let r of e)if(r.type===`text_delta`||r.type===`content`){let e=r.text||``;t+=e,yield{type:`text_delta`,text:e}}else r.type===`tool_use`&&(n.push(r),yield r);yield{type:`response`,content:t,tool_calls:n,stop_reason:n.length?`tool_use`:`end_turn`}}else{let t=await e;t.content&&(yield{type:`text_delta`,text:t.content}),yield{type:`response`,content:t.content,tool_calls:t.tool_calls||[],stop_reason:t.stop_reason}}return}catch(t){if(f=t,e<d.length-1)continue;throw t}try{let e=p===`anthropic`,r=(h||(e?`https://api.anthropic.com`:`https://api.openai.com`)).replace(/\/+$/,``),i,a,o;if(e){i=r.endsWith(`/v1`)?`${r}/messages`:`${r}/v1/messages`,a={"content-type":`application/json`,"x-api-key":g,"anthropic-version":`2023-06-01`};let e=[];for(let n of t)if(n.role===`user`)e.push({role:`user`,content:n.content});else if(n.role===`assistant`)if(n.tool_calls?.length){let t=[];n.content&&t.push({type:`text`,text:n.content});for(let e of n.tool_calls)t.push({type:`tool_use`,id:e.id,name:e.name,input:e.input});e.push({role:`assistant`,content:t})}else e.push({role:`assistant`,content:n.content});else if(n.role===`tool`){let t={type:`tool_result`,tool_use_id:n.tool_call_id,content:n.content},r=e[e.length-1];r?.role===`user`&&Array.isArray(r.content)&&r.content[0]?.type===`tool_result`?r.content.push(t):e.push({role:`user`,content:[t]})}o={model:m||`claude-sonnet-4`,max_tokens:4096,messages:e,stream:!0},s&&(o.system=[{type:`text`,text:s,cache_control:{type:`ephemeral`}}]),n?.length&&(o.tools=n.map((e,t)=>t===n.length-1?{...e,cache_control:{type:`ephemeral`}}:e)),a[`anthropic-beta`]=`prompt-caching-2024-07-31`,_&&(a={...a,"x-base-url":h||`https://api.anthropic.com`,"x-provider":`anthropic`},i=_)}else{i=r.includes(`/v1`)?`${r}/chat/completions`:`${r}/v1/chat/completions`,a={"content-type":`application/json`,authorization:`Bearer ${g}`};let e=s?[{role:`system`,content:s},...t]:t;o={model:m||`gpt-4`,messages:e,stream:!0},n?.length&&(o.tools=n.map(e=>({type:`function`,function:{name:e.name,description:e.description,parameters:e.input_schema}})),o.tool_choice=`auto`),_&&(a[`x-base-url`]=h||`https://api.openai.com`,a[`x-provider`]=`openai`,i=_)}let c=e?k(i,a,o,l):j(i,a,o,l),u=``,d=[],f=`end_turn`,v={};for await(let e of c)if(e.type===`text_delta`)u+=e.text,yield e;else if(e.type===`tool_ready`)d.push(e.toolCall),yield e;else if(e.type===`tool_delta`){let t=e.toolDelta;v[t.index]||(v[t.index]={id:``,name:``,arguments:``}),t.id&&(v[t.index].id=t.id),t.name&&(v[t.index].name=t.name),t.arguments&&(v[t.index].arguments+=t.arguments)}else e.type===`stop`?f=e.stop_reason:e.type===`usage`&&(yield e);if(Object.keys(v).length)for(let e of Object.values(v)){if(!e.name)continue;let t={};try{t=JSON.parse(e.arguments||`{}`)}catch{}let n={id:e.id,name:e.name,input:t};d.push(n),yield{type:`tool_ready`,toolCall:n}}yield{type:`response`,content:u,tool_calls:d,stop_reason:f};return}catch(t){if(f=t,e<d.length-1)continue;throw t}}throw f}async function*T(e,t){let{provider:n=`anthropic`,baseUrl:r,apiKey:i,model:a,tools:s=[`search`,`code`],searchApiKey:c,history:l,proxyUrl:u,stream:d=!0,schema:f,retries:p=2,system:y,images:b,audio:x,signal:S,providers:T}=t;if(!i&&(!T||!T.length))throw Error(`API Key required`);if(f){yield{type:`done`,answer:(await R(e,t,function(){})).answer,rounds:1,stopReason:`end_turn`,messages:[]};return}let{defs:O,customTools:k}=F(s),A=[];if(l?.length&&A.push(...l),b?.length||x){let t=[];if(b?.length)for(let e of b)if(n===`anthropic`)t.push({type:`image`,source:{type:`base64`,media_type:e.media_type||`image/jpeg`,data:e.data}});else{let n=e.url||`data:${e.media_type||`image/jpeg`};base64,${e.data}`;t.push({type:`image_url`,image_url:{url:n,detail:e.detail||`low`}})}x&&(n===`anthropic`?console.warn(`[agenticAsk] Anthropic does not support audio input`):t.push({type:`input_audio`,input_audio:{data:x.data,format:x.format||`wav`}})),t.push({type:`text`,text:e}),A.push({role:`user`,content:t})}else A.push({role:`user`,content:e});let j=0,M=null,N={toolCallHistory:[]},P=Date.now();console.log(`[agenticAsk] Starting with prompt:`,e.slice(0,50)),console.log(`[agenticAsk] Tools available:`,s,`Stream:`,d),console.log(`[agenticAsk] Provider:`,n);let L=O.length>0,z=L?y?o+`

`+y:o:y;for(yield{type:`config`,eager:L,tools:O.length,provider:n};j<v;){if(j++,S&&S.aborted){yield{type:`error`,error:`aborted`,category:`network`,retryable:!1};return}let e=Date.now(),t=0;console.log(`\n[Round ${j}] Calling LLM...`),yield{type:`status`,message:`Round ${j}/${v}`};let o=d&&(n===`anthropic`||!O.length||j>1),s,l=new Map;if(o)try{let e=w({messages:A,tools:O,model:a,baseUrl:r,apiKey:i,proxyUrl:u,system:z,provider:n,signal:S,providers:T});for await(let n of e)if(n.type===`text_delta`)t||=Date.now(),yield n;else if(n.type===`tool_ready`){let e=n.toolCall,t=(async()=>{let t=Date.now();try{return{call:e,result:await I(e.name,e.input,{searchApiKey:c,customTools:k}),error:null,ms:Date.now()-t}}catch(n){return{call:e,result:null,error:n.message||String(n),ms:Date.now()-t}}})();l.set(e.id,t)}else n.type===`response`&&(s=n)}catch(e){let t=_(e);yield{type:`error`,error:e.message,category:t.category,retryable:t.retryable};return}else{try{s=await C({messages:A,tools:O,model:a,baseUrl:r,apiKey:i,proxyUrl:u,stream:!1,system:z,provider:n,signal:S,providers:T})}catch(e){let t=_(e);yield{type:`error`,error:e.message,category:t.category,retryable:t.retryable};return}s.content&&(t=Date.now(),yield{type:`text_delta`,text:s.content})}let f=Date.now()-e,p=t?t-e:null;if(console.log(`[Round ${j}] LLM done in ${f}ms (TTFT: ${p??`n/a`}ms)`),yield{type:`timing`,round:j,phase:`llm`,ms:f,ttft:p},console.log(`[Round ${j}] LLM Response:`),console.log(`  - stop_reason: ${s.stop_reason}`),console.log(`  - content:`,s.content),console.log(`  - tool_calls: ${s.tool_calls?.length||0}`),[`end_turn`,`stop`].includes(s.stop_reason)||!s.tool_calls?.length){console.log(`[Round ${j}] Done: stop_reason=${s.stop_reason}, tool_calls=${s.tool_calls?.length||0}`),M=s.content;break}if(console.log(`[Round ${j}] Executing ${s.tool_calls.length} tool calls...`),A.push({role:`assistant`,content:s.content,tool_calls:s.tool_calls}),S&&S.aborted){yield{type:`error`,error:`aborted`,category:`network`,retryable:!1};return}let y=[];for(let e of s.tool_calls){h(N,e.name,e.input);let t=m(N,e.name,e.input);if(t.stuck){if(console.log(`[Round ${j}] Loop detected: ${t.detector} (${t.level})`),yield{type:`warning`,level:t.level,message:t.message},t.level===`critical`){M=`[Loop Detection] ${t.message}`;break}A.push({role:`tool`,tool_call_id:e.id,content:JSON.stringify({error:`LOOP_DETECTED: ${t.message}`})})}else y.push(e)}if(!M&&y.length){for(let e of y)yield{type:`tool_use`,id:e.id,name:e.name,input:e.input};let e=Date.now(),t=[],n=l.size>0;n&&console.log(`[Round ${j}] ${l.size}/${y.length} tools started eagerly during LLM stream`);let r=await Promise.all(y.map(async e=>{try{let n;if(l.has(e.id)){let t=await l.get(e.id);return g(N,e.name,e.input,t.result,t.error),t}if(n=await I(e.name,e.input,{searchApiKey:c,customTools:k}),n&&typeof n[Symbol.asyncIterator]==`function`){let r=null;for await(let i of n)i._final?r=i.result??i:t.push({type:`tool_progress`,id:e.id,name:e.name,delta:i});let i=r??{streamed:!0};return g(N,e.name,e.input,i,null),{call:e,result:i,error:null}}return g(N,e.name,e.input,n,null),{call:e,result:n,error:null}}catch(t){let n=t instanceof Error?t.message:String(t);return g(N,e.name,e.input,null,n),{call:e,result:null,error:n}}}));console.log(`[Round ${j}] All ${y.length} tools done in ${Date.now()-e}ms${n?` (eager+parallel)`:` (parallel)`}`);let i=Date.now()-e;yield{type:`timing`,round:j,phase:`tools`,ms:i,eager:n,count:y.length};for(let e of t)yield e;for(let{call:e,result:t,error:n}of r)n?(A.push({role:`tool`,tool_call_id:e.id,content:JSON.stringify({error:n})}),yield{type:`tool_error`,id:e.id,name:e.name,error:n}):(A.push({role:`tool`,tool_call_id:e.id,content:JSON.stringify(t)}),yield{type:`tool_result`,id:e.id,name:e.name,output:t})}if(M)break}if(console.log(`\n[agenticAsk] Loop ended at round ${j}`),!M){console.log(`[agenticAsk] Generating final answer (no tools)...`),yield{type:`status`,message:`Generating final answer...`};try{if(d){let e=``;for await(let t of w({messages:A,tools:[],model:a,baseUrl:r,apiKey:i,proxyUrl:u,system:y,provider:n,signal:S,providers:T}))t.type===`text_delta`?(e+=t.text,yield t):t.type;M=e||`(no response)`}else M=(await(n===`anthropic`?E:D)({messages:A,tools:[],model:a,baseUrl:r,apiKey:i,proxyUrl:u,stream:!1,emit:function(){},system:y,signal:S})).content||`(no response)`}catch(e){let t=_(e);yield{type:`error`,error:e.message,category:t.category,retryable:t.retryable};return}console.log(`[agenticAsk] Final answer:`,M.slice(0,100))}console.log(`[agenticAsk] Complete. Total rounds:`,j,`Total time:`,Date.now()-P,`ms`),yield{type:`done`,answer:M,rounds:j,stopReason:`end_turn`,messages:A,totalMs:Date.now()-P}}async function E({messages:e,tools:t,model:n=`claude-sonnet-4`,baseUrl:r=`https://api.anthropic.com`,apiKey:i,proxyUrl:a,stream:o=!1,emit:s,system:c,signal:l,onToolReady:u}){let d=r.replace(/\/+$/,``),f=d.endsWith(`/v1`)?`${d}/messages`:`${d}/v1/messages`,p=[];for(let t of e)if(t.role===`user`)p.push({role:`user`,content:t.content});else if(t.role===`assistant`)if(t.tool_calls?.length){let e=[];t.content&&e.push({type:`text`,text:t.content});for(let n of t.tool_calls)e.push({type:`tool_use`,id:n.id,name:n.name,input:n.input});p.push({role:`assistant`,content:e})}else p.push({role:`assistant`,content:t.content});else if(t.role===`tool`){let e={type:`tool_result`,tool_use_id:t.tool_call_id,content:t.content},n=p[p.length-1];n?.role===`user`&&Array.isArray(n.content)&&n.content[0]?.type===`tool_result`?n.content.push(e):p.push({role:`user`,content:[e]})}let m={model:n,max_tokens:4096,messages:p,stream:o};t?.length&&(m.tools=t);let h={"content-type":`application/json`,"x-api-key":i,"anthropic-version":`2023-06-01`};if((c||t?.length)&&(h[`anthropic-beta`]=`prompt-caching-2024-07-31`),c&&(m.system=[{type:`text`,text:c,cache_control:{type:`ephemeral`}}]),t?.length&&(m.tools=t.map((e,n)=>n===t.length-1?{...e,cache_control:{type:`ephemeral`}}:e)),o&&!a)return await O(f,h,m,s,l,u);if(o&&a)return await O(a,{...h,"x-base-url":r||`https://api.anthropic.com`,"x-provider":`anthropic`},m,s,l,u);let g=await M(f,i,m,a,!0,l);return{content:g.content.find(e=>e.type===`text`)?.text||``,tool_calls:g.content.filter(e=>e.type===`tool_use`).map(e=>({id:e.id,name:e.name,input:e.input})),stop_reason:g.stop_reason}}async function D({messages:e,tools:t,model:n=`gpt-4`,baseUrl:r=`https://api.openai.com`,apiKey:i,proxyUrl:a,stream:o=!1,emit:s,system:c,signal:l,onToolReady:u}){let d=r.replace(/\/+$/,``),f=d.includes(`/v1`)?`${d}/chat/completions`:`${d}/v1/chat/completions`,p={model:n,messages:c?[{role:`system`,content:c},...e]:e,stream:o};t?.length&&(p.tools=t.map(e=>({type:`function`,function:e})));let m={"content-type":`application/json`,authorization:`Bearer ${i}`};if(o&&!a)return await A(f,m,p,s,l,u);if(o&&a)return await A(a,{...m,"x-base-url":r||`https://api.openai.com`,"x-provider":`openai`,"x-api-key":i},p,s,l,u);let h=await M(f,i,p,a,!1,l);if(typeof h==`string`&&h.includes(`chat.completion.chunk`))return N(h);let g=h.choices?.[0];return g?{content:g.message?.content||``,tool_calls:g.message?.tool_calls?.map(e=>{let t={};try{t=JSON.parse(e.function.arguments||`{}`)}catch{}return{id:e.id,name:e.function.name,input:t}})||[],stop_reason:g.finish_reason}:{content:``,tool_calls:[],stop_reason:`stop`}}async function O(e,t,n,r,i,a){let o=``,s=[],c=`end_turn`;for await(let l of k(e,t,n,i))l.type===`text_delta`?(o+=l.text,r(`token`,{text:l.text})):l.type===`tool_ready`?(s.push(l.toolCall),a&&a(l.toolCall)):l.type===`stop`&&(c=l.stop_reason);return{content:o,tool_calls:s,stop_reason:c}}async function*k(e,t,n,r){let i={method:`POST`,headers:t,body:JSON.stringify(n)};r&&(i.signal=r);let a=await fetch(e,i);if(!a.ok){let e=await a.text(),t=Error(`API error ${a.status}: ${e.slice(0,300)}`);throw t.status=a.status,t}let o=a.body.getReader(),s=new TextDecoder,c=``,l=``,u=null;for(;;){let{done:e,value:t}=await o.read();if(e)break;c+=s.decode(t,{stream:!0});let n=c.split(`
`);c=n.pop()||``;for(let e of n){if(!e.startsWith(`data: `))continue;let t=e.slice(6).trim();if(t!==`[DONE]`)try{let e=JSON.parse(t);if(e.type===`message_start`&&e.message?.usage&&(yield{type:`usage`,usage:e.message.usage}),e.type===`content_block_delta`)e.delta?.type===`text_delta`?yield{type:`text_delta`,text:e.delta.text}:e.delta?.type===`input_json_delta`&&(l+=e.delta.partial_json||``);else if(e.type===`content_block_start`)e.content_block?.type===`tool_use`&&(u={id:e.content_block.id,name:e.content_block.name},l=``);else if(e.type===`content_block_stop`){if(u){let e={};try{e=JSON.parse(l||`{}`)}catch{}yield{type:`tool_ready`,toolCall:{...u,input:e}},u=null,l=``}}else e.type===`message_delta`&&(e.usage&&(yield{type:`usage`,usage:e.usage}),e.delta?.stop_reason&&(yield{type:`stop`,stop_reason:e.delta.stop_reason}))}catch{}}}}async function A(e,t,n,r,i,a){let o=``,s=`stop`,c={};for await(let a of j(e,t,n,i))if(a.type===`text_delta`)o+=a.text,r(`token`,{text:a.text});else if(a.type===`tool_delta`){let e=a.toolDelta;c[e.index]||(c[e.index]={id:``,name:``,arguments:``}),e.id&&(c[e.index].id=e.id),e.name&&(c[e.index].name=e.name),e.arguments&&(c[e.index].arguments+=e.arguments)}else a.type===`stop`&&(s=a.stop_reason);let l=Object.values(c).filter(e=>e.name).map(e=>{let t={};try{t=JSON.parse(e.arguments||`{}`)}catch{}return{id:e.id,name:e.name,input:t}});if(a)for(let e of l)a(e);return{content:o,tool_calls:l,stop_reason:s}}async function*j(e,t,n,r){let i={method:`POST`,headers:t,body:JSON.stringify(n)};r&&(i.signal=r);let a=await fetch(e,i);if(!a.ok){let e=await a.text(),t=Error(`API error ${a.status}: ${e.slice(0,300)}`);throw t.status=a.status,t}let o=a.body.getReader(),s=new TextDecoder,c=``;for(;;){let{done:e,value:t}=await o.read();if(e)break;c+=s.decode(t,{stream:!0});let n=c.split(`
`);c=n.pop()||``;for(let e of n){if(!e.startsWith(`data: `))continue;let t=e.slice(6).trim();if(t!==`[DONE]`)try{let e=JSON.parse(t),n=e.choices?.[0]?.delta;if(!n)continue;if(n.content&&(yield{type:`text_delta`,text:n.content}),e.choices?.[0]?.finish_reason&&(yield{type:`stop`,stop_reason:e.choices[0].finish_reason}),n.tool_calls)for(let e of n.tool_calls)yield{type:`tool_delta`,toolDelta:{index:e.index,id:e.id||``,name:e.function?.name||``,arguments:e.function?.arguments||``}}}catch{}}}}async function M(e,t,n,r,i=!1,a){let o={"content-type":`application/json`};if(i?(o[`x-api-key`]=t,o[`anthropic-version`]=`2023-06-01`):o.authorization=`Bearer ${t}`,r){let s={method:`POST`,headers:{...o,"x-base-url":e.replace(/\/v1\/.*$/,``),"x-provider":i?`anthropic`:`openai`,"x-api-key":t},body:JSON.stringify(n)};a&&(s.signal=a);let c=await fetch(r,s);if(!c.ok){let e=await c.text(),t=Error(`API error ${c.status}: ${e.slice(0,300)}`);throw t.status=c.status,t}return await c.json()}else{let t={method:`POST`,headers:o,body:JSON.stringify(n)};a&&(t.signal=a);let r=await fetch(e,t);if(!r.ok){let e=await r.text(),t=Error(`API error ${r.status}: ${e}`);throw t.status=r.status,t}let i=await r.text();return i.trimStart().startsWith(`data: `)?P(i):JSON.parse(i)}}function N(e){let t=e.split(`
`),n=``,r=[],i=null,a=!1;for(let e of t)if(e.trim())try{let t=e;if(e.includes(`data: `)&&(t=e.split(`data: `)[1]),!t||!t.includes(`{`))continue;let o=t.indexOf(`{`),s=t.lastIndexOf(`}`);if(o===-1||s===-1)continue;let c=JSON.parse(t.substring(o,s+1));c.choices?.[0]?.delta?.content&&(n+=c.choices[0].delta.content,a=!1),c.name?(i&&i.name!==c.name&&r.push(i),i={id:c.call_id||`call_${Date.now()}`,name:c.name,arguments:c.arguments||``},a=!0):a&&c.arguments!==void 0&&i&&(i.arguments+=c.arguments)}catch{}i&&r.push(i);let o=r.map(e=>{let t={};try{e.arguments.trim()&&(t=JSON.parse(e.arguments))}catch{}return{id:e.id,name:e.name,input:t}});return{content:n,tool_calls:o,stop_reason:o.length>0?`tool_use`:`stop`}}function P(e){let t=e.split(`
`),n=``,r={},i=``,a=null,o=null;for(let e of t)if(!(!e.startsWith(`data: `)||e===`data: [DONE]`))try{let t=JSON.parse(e.slice(6));t.model&&(i=t.model),t.usage&&(a=t.usage);let s=t.choices?.[0]?.delta;if(!s)continue;if(s.content&&(n+=s.content),s.finish_reason&&(o=s.finish_reason),t.choices?.[0]?.finish_reason&&(o=t.choices[0].finish_reason),s.tool_calls)for(let e of s.tool_calls)r[e.index]||(r[e.index]={id:``,name:``,arguments:``}),e.id&&(r[e.index].id=e.id),e.function?.name&&(r[e.index].name=e.function.name),e.function?.arguments&&(r[e.index].arguments+=e.function.arguments)}catch{}let s=Object.values(r).filter(e=>e.name);return{choices:[{message:{content:n,tool_calls:s.length?s.map(e=>({id:e.id,type:`function`,function:{name:e.name,arguments:e.arguments}})):void 0},finish_reason:o||`stop`}],model:i,usage:a||{prompt_tokens:0,completion_tokens:0}}}function F(e){let t=[],n=[];for(let e of B.list())t.push({name:e.name,description:e.description,input_schema:e.parameters});for(let r of e)typeof r==`string`?r===`search`?t.push({name:`search`,description:`Search the web for current information`,input_schema:{type:`object`,properties:{query:{type:`string`,description:`Search query`}},required:[`query`]}}):r===`code`&&t.push({name:`execute_code`,description:`Execute Python code`,input_schema:{type:`object`,properties:{code:{type:`string`,description:`Python code to execute`}},required:[`code`]}}):typeof r==`object`&&r.name&&(t.push({name:r.name,description:r.description||``,input_schema:r.parameters||r.input_schema||{type:`object`,properties:{}}}),n.push(r));return{defs:t,customTools:n}}async function I(e,t,n){let r=B.get(e);if(r&&r.execute){let e=r.execute(t);return e&&typeof e[Symbol.asyncIterator]==`function`?e:await e}if(n.customTools){let r=n.customTools.find(t=>t.name===e);if(r&&r.execute){let e=r.execute(t);return e&&typeof e[Symbol.asyncIterator]==`function`?e:await e}}return e===`search`?await L(t.query,n.searchApiKey):e===`execute_code`?{output:`[Code execution not available in browser]`}:{error:`Unknown tool`}}async function L(e,t){return t?{results:(await(await fetch(`https://api.tavily.com/search`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({api_key:t,query:e,max_results:5})})).json()).results||[]}:{error:`Search API key required`}}async function R(e,t,n){let{provider:r=`anthropic`,baseUrl:i,apiKey:a,model:o,history:s,proxyUrl:c,schema:l,retries:u=2,images:d}=t,f=`You must respond with valid JSON that matches this schema:\n${JSON.stringify(l,null,2)}\n\nRules:\n- Output ONLY the JSON object, no markdown, no explanation, no code fences\n- All required fields must be present\n- Types must match exactly`,p=f+`

`+e;if(d?.length){let t=[];for(let e of d)if(r===`anthropic`)t.push({type:`image`,source:{type:`base64`,media_type:e.media_type||`image/jpeg`,data:e.data}});else{let n=e.url||`data:${e.media_type||`image/jpeg`};base64,${e.data}`;t.push({type:`image_url`,image_url:{url:n,detail:e.detail||`auto`}})}t.push({type:`text`,text:f+`

`+e}),p=t}let m=[];s?.length&&m.push(...s),m.push({role:`user`,content:e});let h=null;for(let e=0;e<=u;e++){e>0&&(console.log(`[schema] Retry ${e}/${u}: ${h}`),n(`status`,{message:`Retry ${e}/${u}...`}),m.push({role:`assistant`,content:h.raw}),m.push({role:`user`,content:`That JSON was invalid: ${h.message}\n\nPlease fix and return ONLY valid JSON matching the schema.`})),n(`status`,{message:e===0?`Generating structured output...`:`Retry ${e}/${u}...`});let t=(await(r===`anthropic`?E:D)({messages:[{role:`user`,content:p}],tools:[],model:o,baseUrl:i,apiKey:a,proxyUrl:c,stream:!1,emit:n})).content.trim(),s=t,d=t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);d&&(s=d[1].trim());let f;try{f=JSON.parse(s)}catch(e){h={message:`JSON parse error: ${e.message}`,raw:t};continue}let g=z(f,l);if(!g.valid){h={message:g.error,raw:t};continue}return{answer:t,data:f,attempts:e+1}}throw Error(`Schema validation failed after ${u+1} attempts: ${h.message}`)}function z(e,t){if(!t||!t.type)return{valid:!0};if(t.type===`object`){if(typeof e!=`object`||!e||Array.isArray(e))return{valid:!1,error:`Expected object, got ${Array.isArray(e)?`array`:typeof e}`};if(t.required){for(let n of t.required)if(!(n in e))return{valid:!1,error:`Missing required field: "${n}"`}}if(t.properties){for(let[n,r]of Object.entries(t.properties))if(n in e&&e[n]!==null&&e[n]!==void 0){let t=e[n];if(r.type===`string`&&typeof t!=`string`)return{valid:!1,error:`Field "${n}" should be string, got ${typeof t}`};if(r.type===`number`&&typeof t!=`number`)return{valid:!1,error:`Field "${n}" should be number, got ${typeof t}`};if(r.type===`boolean`&&typeof t!=`boolean`)return{valid:!1,error:`Field "${n}" should be boolean, got ${typeof t}`};if(r.type===`array`&&!Array.isArray(t))return{valid:!1,error:`Field "${n}" should be array, got ${typeof t}`};if(r.enum&&!r.enum.includes(t))return{valid:!1,error:`Field "${n}" must be one of: ${r.enum.join(`, `)}`}}}}else if(t.type===`array`){if(!Array.isArray(e))return{valid:!1,error:`Expected array, got ${typeof e}`}}else if(t.type===`string`){if(typeof e!=`string`)return{valid:!1,error:`Expected string, got ${typeof e}`}}else if(t.type===`number`&&typeof e!=`number`)return{valid:!1,error:`Expected number, got ${typeof e}`};return{valid:!0}}var B={_tools:new Map,register(e,t){if(!e||typeof e!=`string`)throw Error(`Tool name required`);if(!t||typeof t!=`object`)throw Error(`Tool must be an object`);if(!t.description)throw Error(`Tool description required`);if(!t.execute||typeof t.execute!=`function`)throw Error(`Tool execute function required`);this._tools.set(e,{name:e,description:t.description,parameters:t.parameters||{type:`object`,properties:{}},execute:t.execute,streaming:!!t.streaming})},unregister(e){this._tools.delete(e)},get(e){return this._tools.get(e)},list(e){let t=Array.from(this._tools.values());return e?t.filter(t=>t.category===e):t},clear(){this._tools.clear()}};async function V(e,t={}){let{provider:n=`openai`,baseUrl:r=`https://api.openai.com`,apiKey:i,proxyUrl:a,model:o=`tts-1`,voice:s=`alloy`,format:c=`mp3`}=t;if(!i)throw Error(`API key required for TTS`);if(!e?.trim())return null;if(n===`elevenlabs`){let t=s,n=o||`eleven_turbo_v2_5`;return(await W(`https://api.elevenlabs.io/v1/text-to-speech/${t}`,{method:`POST`,headers:{"xi-api-key":i,"Content-Type":`application/json`},body:JSON.stringify({text:e,model_id:n,voice_settings:{stability:.5,similarity_boost:.75}})})).arrayBuffer()}let l=`${(r||``).replace(/\/+$/,``).replace(/\/v1$/,``)}/v1/audio/speech`,u=a||l,d={Authorization:`Bearer ${i}`,"Content-Type":`application/json`};return a&&(d[`X-Target-URL`]=l),(await W(u,{method:`POST`,headers:d,body:JSON.stringify({model:o,voice:s,input:e,response_format:c})})).arrayBuffer()}async function H(e,t={}){let{provider:n=`openai`,baseUrl:r=`https://api.openai.com`,apiKey:i,proxyUrl:a,model:o=`whisper-1`,language:s=`zh`,timestamps:c=!1}=t;if(!i)throw Error(`API key required for STT`);if(n===`elevenlabs`){let t=o||`scribe_v2`,n=U(e,`audio.wav`,`audio/wav`);n.append(`model_id`,t);let r=await(await W(`https://api.elevenlabs.io/v1/speech-to-text`,{method:`POST`,headers:{"xi-api-key":i},body:n})).json();return c?r:r.text?.trim()||``}let l=`${(r||``).replace(/\/+$/,``).replace(/\/v1$/,``)}/v1/audio/transcriptions`,u=a||l,d=U(e,`audio.wav`,`audio/wav`);d.append(`model`,o),s&&d.append(`language`,s.split(`-`)[0]),c&&(d.append(`response_format`,`verbose_json`),d.append(`timestamp_granularities[]`,`word`));let f={Authorization:`Bearer ${i}`};a&&(f[`X-Target-URL`]=l);let p=await(await W(u,{method:`POST`,headers:f,body:d})).json();return c?p:p.text?.trim()||``}function U(e,n,r){if(typeof Buffer<`u`&&Buffer.isBuffer(e)){let t=new Blob([e],{type:r}),i=new FormData;return i.append(`file`,t,n),i}if(e instanceof ArrayBuffer||e?.buffer instanceof ArrayBuffer){let t=new Blob([e],{type:r}),i=new FormData;return i.append(`file`,t,n),i}if(e instanceof Blob){let t=new FormData;return t.append(`file`,e,n),t}if(typeof e==`string`&&typeof require==`function`){let i=t().readFileSync(e),a=new Blob([i],{type:r}),o=new FormData;return o.append(`file`,a,n),o}throw Error(`Unsupported audio input type`)}async function W(e,t,n=3){let r;for(let i=0;i<n;i++)try{let n=await fetch(e,t);if(!n.ok){let e=await n.text().catch(()=>``);throw Error(`Audio API ${n.status}: ${e.slice(0,300)}`)}return n}catch(e){r=e,i<n-1&&await new Promise(e=>setTimeout(e,500*(i+1)))}throw r}async function G(e={}){let{provider:t=`anthropic`,apiKey:n,baseUrl:r,model:i,system:a,tools:s=[],proxyUrl:c,providers:l}=e;if(!n&&(!l||!l.length))return console.warn(`[warmup] No API key, skipping`),{ok:!1,reason:`no_api_key`};let u=Date.now(),{defs:d}=F(s),f=d.length>0?a?o+`

`+a:o:a;try{if(t===`anthropic`){let e=(r||`https://api.anthropic.com`).replace(/\/+$/,``),t=e.endsWith(`/v1`)?`${e}/messages`:`${e}/v1/messages`,a={"content-type":`application/json`,"x-api-key":n,"anthropic-version":`2023-06-01`,"anthropic-beta":`prompt-caching-2024-07-31`},o={model:i||`claude-sonnet-4`,max_tokens:1,messages:[{role:`user`,content:`hi`}],stream:!1};f&&(o.system=[{type:`text`,text:f,cache_control:{type:`ephemeral`}}]),d.length&&(o.tools=d.map((e,t)=>t===d.length-1?{...e,cache_control:{type:`ephemeral`}}:e));let s=c||t,l=c?{...a,"x-base-url":r||`https://api.anthropic.com`,"x-provider":`anthropic`}:a,p=await(await fetch(s,{method:`POST`,headers:l,body:JSON.stringify(o)})).json(),m=Date.now()-u,h=p.usage?.cache_creation_input_tokens||0,g=p.usage?.cache_read_input_tokens||0;return console.log(`[warmup] Anthropic ${m}ms — cache_created: ${h}, cache_hit: ${g}`),{ok:!0,ms:m,cacheCreated:h,cacheHit:g,provider:`anthropic`}}else{let e=(r||`https://api.openai.com`).replace(/\/+$/,``),t=e.includes(`/v1`)?`${e}/chat/completions`:`${e}/v1/chat/completions`,a={model:i||`gpt-4`,max_tokens:1,messages:[{role:`user`,content:`hi`}],stream:!1};await(await fetch(t,{method:`POST`,headers:{"content-type":`application/json`,authorization:`Bearer ${n}`},body:JSON.stringify(a)})).json();let o=Date.now()-u;return console.log(`[warmup] OpenAI ${o}ms (connection only)`),{ok:!0,ms:o,provider:`openai`}}}catch(e){let t=Date.now()-u;return console.warn(`[warmup] Failed in ${t}ms:`,e.message),{ok:!1,ms:t,error:e.message}}}async function K(e,t){let{provider:n=`anthropic`,baseUrl:r,apiKey:i,model:a,tools:o=[],proxyUrl:s,stream:c=!1,system:l,signal:u,providers:d,emit:f}=t;if(!i&&(!d||!d.length))throw Error(`API Key required`);let p=[];o.length>0&&typeof o[0]==`object`&&o[0].name?p=o.map(e=>({name:e.name,description:e.description,input_schema:e.input_schema||{type:`object`,properties:{}}})):o.length>0&&typeof o[0]==`string`&&(p=F(o).defs);let m=f||(()=>{}),h,g=``;if(c)try{let t=w({messages:e,tools:p,model:a,baseUrl:r,apiKey:i,proxyUrl:s,system:l,provider:n,signal:u,providers:d});for await(let e of t)e.type===`text_delta`?(g+=e.text,m(`token`,{text:e.text})):e.type===`response`&&(h=e)}catch(e){throw e}else try{h=await C({messages:e,tools:p,model:a,baseUrl:r,apiKey:i,proxyUrl:s,stream:!1,system:l,provider:n,signal:u,providers:d}),g=h.content||``}catch(e){throw e}let _=h.tool_calls||[],v=[`end_turn`,`stop`].includes(h.stop_reason)||_.length===0,y=[...e];return _.length>0?y.push({role:`assistant`,content:g||``,tool_calls:_}):g&&y.push({role:`assistant`,content:g}),{text:g,toolCalls:_.map(e=>({id:e.id,name:e.name,input:e.input})),messages:y,done:v,stopReason:h.stop_reason}}function q(e,t){return e.map((e,n)=>{let r=t[n],i=r.error?JSON.stringify({error:r.error}):JSON.stringify(r.output??r);return{role:`tool`,tool_call_id:e.id,content:i}})}function J(e,t={}){let{system:n,tools:r,stream:i=!0,provider:a,apiKey:o,baseUrl:s,model:c,proxyUrl:l,signal:u,providers:d,images:f,audio:p,schema:m,searchApiKey:h}=t,g=e[e.length-1],_=typeof g?.content==`string`?g.content:JSON.stringify(g?.content||``),v={provider:a,apiKey:o,baseUrl:s,model:c,proxyUrl:l,signal:u,providers:d,history:e.slice(0,-1),system:n,tools:r,stream:i,images:f,audio:p,schema:m,searchApiKey:h};for(let e of Object.keys(v))v[e]===void 0&&delete v[e];return T(_,v)}async function Y(e,t={}){let n=``,r=[],i,a=0;for await(let o of J(e,t))o.type===`done`?(n=o.answer||``,a=o.rounds||0,i=o.usage):o.type===`tool_use`&&r.push({id:o.id,name:o.name,input:o.input});return{answer:n,tool_calls:r,usage:i,rounds:a}}e.agenticAsk=y,e.agenticStep=K,e.buildToolResults=q,e.chat=J,e.chatResult=Y,e.classifyError=_,e.registerProvider=x,e.synthesize=V,e.toolRegistry=B,e.transcribe=H,e.unregisterProvider=S,e.warmup=G});

// ═══ agentic-store.js ═══
(function(e,t){typeof exports==`object`&&typeof module<`u`?t(exports):typeof define==`function`&&define.amd?define([`exports`],t):(e=typeof globalThis<`u`?globalThis:e||self,t(e.AgenticStore={}))})(this,function(e){Object.defineProperty(e,Symbol.toStringTag,{value:`Module`});var t=((e,t)=>()=>(t||(e((t={exports:{}}).exports,t),e=null),t.exports))(((e,t)=>{t.exports={}})),n=`_kv`,r=`CREATE TABLE IF NOT EXISTS ${n} (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)`;function i(e){let t=null,i=null,a=`agentic-store-`+e;async function o(){return new Promise(e=>{try{let t=indexedDB.open(a,1);t.onupgradeneeded=()=>t.result.createObjectStore(`db`),t.onsuccess=()=>{let n=t.result.transaction(`db`,`readonly`).objectStore(`db`).get(`data`);n.onsuccess=()=>{t.result.close(),e(n.result||null)},n.onerror=()=>{t.result.close(),e(null)}},t.onerror=()=>e(null)}catch{e(null)}})}async function s(){if(!t)return;let e=t.export();return new Promise(t=>{try{let n=indexedDB.open(a,1);n.onupgradeneeded=()=>n.result.createObjectStore(`db`),n.onsuccess=()=>{let r=n.result.transaction(`db`,`readwrite`);r.objectStore(`db`).put(e,`data`),r.oncomplete=()=>{n.result.close(),t()},r.onerror=()=>{n.result.close(),t()}},n.onerror=()=>t()}catch{t()}})}let c=null;function l(){c&&clearTimeout(c),c=setTimeout(()=>{s(),c=null},300)}return{async init(){if(!i)if(typeof initSqlJs==`function`)i=await initSqlJs();else if(typeof root<`u`&&root.initSqlJs)i=await root.initSqlJs();else throw Error(`sql.js not found. Load it via <script src="https://sql.js.org/dist/sql-wasm.js"> or import.`);let e=await o();t=e?new i.Database(e):new i.Database,t.run(r)},exec(e,n){t.run(e,n),l()},run(e,n){t.run(e,n),l()},all(e,n){let r=t.prepare(e);n&&r.bind(n);let i=[];for(;r.step();)i.push(r.getAsObject());return r.free(),i},get(e,t){let n=this.all(e,t);return n.length>0?n[0]:void 0},async kvGet(e){let t=this.get(`SELECT value FROM ${n} WHERE key = ?`,[e]);if(t)try{return JSON.parse(t.value)}catch{return t.value}},async kvSet(e,t){this.run(`INSERT OR REPLACE INTO ${n} (key, value, updated_at) VALUES (?, ?, ?)`,[e,JSON.stringify(t),Date.now()])},async kvDelete(e){this.run(`DELETE FROM ${n} WHERE key = ?`,[e])},async kvKeys(){return this.all(`SELECT key FROM ${n}`).map(e=>e.key)},async kvClear(){this.run(`DELETE FROM ${n}`)},async kvHas(e){return!!this.get(`SELECT 1 FROM ${n} WHERE key = ?`,[e])},async flush(){await s()},async close(){c&&(clearTimeout(c),await s()),t&&=(t.close(),null)}}}function a(e){let t=null;return{async init(){let n=require(`better-sqlite3`),i=require(`path`),a=require(`fs`),o=i.dirname(e);a.mkdirSync(o,{recursive:!0}),t=new n(e),t.pragma(`journal_mode = WAL`),t.exec(r)},exec(e,n){n?t.prepare(e).run(...Array.isArray(n)?n:[n]):t.exec(e)},run(e,n){t.prepare(e).run(...Array.isArray(n)?n:[])},all(e,n){return t.prepare(e).all(...Array.isArray(n)?n:[])},get(e,n){return t.prepare(e).get(...Array.isArray(n)?n:[])},async kvGet(e){let r=t.prepare(`SELECT value FROM ${n} WHERE key = ?`).get(e);if(r)try{return JSON.parse(r.value)}catch{return r.value}},async kvSet(e,r){t.prepare(`INSERT OR REPLACE INTO ${n} (key, value, updated_at) VALUES (?, ?, ?)`).run(e,JSON.stringify(r),Date.now())},async kvDelete(e){t.prepare(`DELETE FROM ${n} WHERE key = ?`).run(e)},async kvKeys(){return t.prepare(`SELECT key FROM ${n}`).all().map(e=>e.key)},async kvClear(){t.prepare(`DELETE FROM ${n}`).run()},async kvHas(e){return!!t.prepare(`SELECT 1 FROM ${n} WHERE key = ?`).get(e)},async flush(){},async close(){t&&=(t.close(),null)}}}function o(){let e=null;return{async init(){try{e=new(require(`better-sqlite3`))(`:memory:`),e.exec(r);return}catch{}try{let t;if(typeof initSqlJs==`function`?t=await initSqlJs():typeof globalThis<`u`&&globalThis.initSqlJs&&(t=await globalThis.initSqlJs()),t){e=new t.Database,e.run(r);return}}catch{}throw Error(`No SQLite engine found (need better-sqlite3 or sql.js)`)},exec(t,n){e.exec&&!e.prepare?e.run(t,n):n?e.prepare(t).run(...Array.isArray(n)?n:[n]):e.exec(t)},run(e,t){this.exec(e,t)},all(t,n){if(e.prepare&&e.prepare(t).all)return e.prepare(t).all(...Array.isArray(n)?n:[]);let r=e.prepare(t);n&&r.bind(n);let i=[];for(;r.step();)i.push(r.getAsObject());return r.free(),i},get(e,t){let n=this.all(e,t);return n.length>0?n[0]:void 0},async kvGet(e){let t=this.get(`SELECT value FROM ${n} WHERE key = ?`,[e]);if(t)try{return JSON.parse(t.value)}catch{return t.value}},async kvSet(e,t){this.run(`INSERT OR REPLACE INTO ${n} (key, value, updated_at) VALUES (?, ?, ?)`,[e,JSON.stringify(t),Date.now()])},async kvDelete(e){this.run(`DELETE FROM ${n} WHERE key = ?`,[e])},async kvKeys(){return this.all(`SELECT key FROM ${n}`).map(e=>e.key)},async kvClear(){this.run(`DELETE FROM ${n}`)},async kvHas(e){return!!this.get(`SELECT 1 FROM ${n} WHERE key = ?`,[e])},async flush(){},async close(){e&&=(e.close(),null)}}}function s(e){let t=require(`fs`),n=require(`path`);t.mkdirSync(e,{recursive:!0});function r(t){return n.join(e,encodeURIComponent(t)+`.json`)}return{async init(){},async kvGet(e){try{return JSON.parse(t.readFileSync(r(e),`utf8`))}catch{return}},async kvSet(e,n){t.writeFileSync(r(e),JSON.stringify(n))},async kvDelete(e){try{t.unlinkSync(r(e))}catch{}},async kvKeys(){try{return t.readdirSync(e).filter(e=>e.endsWith(`.json`)).map(e=>decodeURIComponent(e.slice(0,-5)))}catch{return[]}},async kvClear(){try{for(let r of t.readdirSync(e))r.endsWith(`.json`)&&t.unlinkSync(n.join(e,r))}catch{}},async kvHas(e){return t.existsSync(r(e))},async flush(){},async close(){}}}function c(e){let t=null;function n(){return t?Promise.resolve(t):new Promise((n,r)=>{let i=indexedDB.open(e,1);i.onupgradeneeded=()=>i.result.createObjectStore(`kv`),i.onsuccess=()=>{t=i.result,n(t)},i.onerror=()=>r(i.error)})}function r(e){return n().then(t=>t.transaction(`kv`,e).objectStore(`kv`))}function i(e){return new Promise((t,n)=>{e.onsuccess=()=>t(e.result),e.onerror=()=>n(e.error)})}return{async init(){await n()},async kvGet(e){return i((await r(`readonly`)).get(e))},async kvSet(e,t){await i((await r(`readwrite`)).put(t,e))},async kvDelete(e){await i((await r(`readwrite`)).delete(e))},async kvKeys(){return i((await r(`readonly`)).getAllKeys())},async kvClear(){await i((await r(`readwrite`)).clear())},async kvHas(e){return await i((await r(`readonly`)).count(e))>0},async flush(){},async close(){t&&=(t.close(),null)}}}function l(e){let t=e+`:`;return{async init(){},async kvGet(e){try{let n=localStorage.getItem(t+e);return n==null?void 0:JSON.parse(n)}catch{return}},async kvSet(e,n){localStorage.setItem(t+e,JSON.stringify(n))},async kvDelete(e){localStorage.removeItem(t+e)},async kvKeys(){let e=[];for(let n=0;n<localStorage.length;n++){let r=localStorage.key(n);r.startsWith(t)&&e.push(r.slice(t.length))}return e},async kvClear(){let e=[];for(let n=0;n<localStorage.length;n++){let r=localStorage.key(n);r.startsWith(t)&&e.push(r)}e.forEach(e=>localStorage.removeItem(e))},async kvHas(e){return localStorage.getItem(t+e)!=null},async flush(){},async close(){}}}function u(){let e=new Map;return{async init(){},async kvGet(t){return e.has(t)?structuredClone(e.get(t)):void 0},async kvSet(t,n){e.set(t,structuredClone(n))},async kvDelete(t){e.delete(t)},async kvKeys(){return[...e.keys()]},async kvClear(){e.clear()},async kvHas(t){return e.has(t)},async flush(){},async close(){e.clear()}}}function d(){if(typeof require<`u`){try{return require(`better-sqlite3`),`sqlite-native`}catch{}try{return require(`fs`),`fs`}catch{}}if(typeof initSqlJs==`function`||typeof globalThis<`u`&&globalThis.initSqlJs)return`sqlite-wasm`;if(typeof indexedDB<`u`)return`idb`;if(typeof localStorage<`u`)try{return localStorage.setItem(`__agentic_store_probe__`,`1`),localStorage.removeItem(`__agentic_store_probe__`),`ls`}catch{}return`mem`}async function f(e,n={}){if(n.custom){let e=n.custom;return e.init&&await e.init(),{get:t=>e.kvGet?e.kvGet(t):e.get(t),set:(t,n)=>e.kvSet?e.kvSet(t,n):e.set(t,n),delete:t=>e.kvDelete?e.kvDelete(t):e.delete(t),keys:()=>e.kvKeys?e.kvKeys():e.keys(),clear:()=>e.kvClear?e.kvClear():e.clear(),has:t=>e.kvHas?e.kvHas(t):e.has(t),flush:()=>e.flush?e.flush():Promise.resolve(),close:()=>e.close?e.close():Promise.resolve(),exec:e.exec?(t,n)=>e.exec(t,n):void 0,run:e.run?(t,n)=>e.run(t,n):void 0,all:e.all?(t,n)=>e.all(t,n):void 0,sql:e.get&&e.exec?(t,n)=>e.get(t,n):void 0,get backend(){return`custom`}}}let r=n.backend||d(),f;switch(r){case`sqlite-wasm`:f=i(e);break;case`sqlite-native`:f=a(n.path||require(`path`).join(t().homedir(),`.agentic-store`,e+`.db`));break;case`sqlite-memory`:f=o();break;case`idb`:f=c(`agentic-store-`+e);break;case`fs`:f=s(n.dir||require(`path`).join(t().homedir(),`.agentic-store`,e));break;case`ls`:f=l(`agentic-store-`+e);break;case`mem`:f=u();break;default:throw Error(`Unknown backend: ${r}`)}await f.init();let p={get:e=>f.kvGet(e),set:(e,t)=>f.kvSet(e,t),delete:e=>f.kvDelete(e),keys:()=>f.kvKeys(),clear:()=>f.kvClear(),has:e=>f.kvHas(e),flush:()=>f.flush(),close:()=>f.close(),get backend(){return r}};return f.exec&&(p.exec=(e,t)=>f.exec(e,t),p.run=(e,t)=>f.run(e,t),p.all=(e,t)=>f.all(e,t),p.sql=(e,t)=>f.get(e,t)),p}e.createStore=f});

// ═══ agentic-shell.js ═══
"use strict";
var AgenticShellBrowser = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/browser.ts
  var browser_exports = {};
  __export(browser_exports, {
    AgenticShell: () => AgenticShell,
    MemFS: () => MemFS,
    createBrowserShell: () => createBrowserShell
  });

  // src/index.ts
  function isStreamable(fs) {
    return typeof fs.readStream === "function";
  }
  var AgenticShell = class {
    constructor(fs) {
      this.fs = fs;
      const required = ["read", "write", "ls", "delete", "grep"];
      const missing = required.filter((m) => typeof fs[m] !== "function");
      if (missing.length) throw new Error(`AgenticShell: fs missing required methods: ${missing.join(", ")}`);
      this.env.set("HOME", "/");
      this.env.set("PWD", this.cwd);
      this.env.set("PATH", "/usr/bin:/bin");
    }
    fs;
    cwd = "/";
    env = /* @__PURE__ */ new Map();
    jobs = /* @__PURE__ */ new Map();
    nextJobId = 1;
    setEnv(key, value) {
      this.env.set(key, value);
    }
    getCwd() {
      return this.cwd;
    }
    substituteEnv(cmd) {
      return cmd.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) => this.env.get(n) ?? "").replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, n) => this.env.get(n) ?? "");
    }
    async substituteCommands(cmd, depth = 0, maxDepth = 3) {
      if (depth >= maxDepth) return cmd;
      let result = cmd;
      while (true) {
        const start = result.indexOf("$(");
        if (start === -1) break;
        let pdepth = 0, end = -1;
        for (let i = start + 1; i < result.length; i++) {
          if (result[i] === "(") pdepth++;
          else if (result[i] === ")") {
            pdepth--;
            if (pdepth === 0) {
              end = i;
              break;
            }
          }
        }
        if (end === -1) break;
        const inner = result.slice(start + 2, end);
        const r = await this.exec(inner, depth + 1);
        result = result.slice(0, start) + (r.exitCode === 0 ? r.output.trim() : "") + result.slice(end + 1);
      }
      while (true) {
        const start = result.indexOf("`");
        if (start === -1) break;
        const end = result.indexOf("`", start + 1);
        if (end === -1) break;
        const inner = result.slice(start + 1, end);
        const r = await this.exec(inner, depth + 1);
        result = result.slice(0, start) + (r.exitCode === 0 ? r.output.trim() : "") + result.slice(end + 1);
      }
      return result;
    }
    getEnv(key) {
      return this.env.get(key);
    }
    isBackground(cmd) {
      const trimmed = cmd.trimEnd();
      if (trimmed.endsWith("&")) return [true, trimmed.slice(0, -1).trimEnd()];
      return [false, cmd];
    }
    async exec(command, depth = 0) {
      const afterEnv = this.substituteEnv(command.trim());
      const substituted = await this.substituteCommands(afterEnv, depth);
      const [isBg, cleanCmd] = this.isBackground(substituted);
      if (isBg) {
        if (!cleanCmd) return { output: "exec: missing command", exitCode: 1 };
        const id = this.nextJobId++;
        const promise = this.execPipeline(cleanCmd).then((result) => {
          this.jobs.get(id).status = "done";
          return result;
        });
        this.jobs.set(id, { id, command: cleanCmd, status: "running", promise });
        return { output: `[${id}] ${id}`, exitCode: 0 };
      }
      return this.execPipeline(substituted);
    }
    async execPipeline(command) {
      const trimmed = command;
      if (!trimmed) return { output: "", exitCode: 0 };
      const assignMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/);
      if (assignMatch) {
        this.env.set(assignMatch[1], assignMatch[2]);
        return { output: "", exitCode: 0 };
      }
      const inputMatch = trimmed.match(/^(.+?)\s+<\s+(\S+)((?:\s*>>?\s*\S+)?)$/);
      if (inputMatch) {
        const lhs = inputMatch[1].trim();
        const redirectFile = this.resolve(inputMatch[2]);
        const remainder = inputMatch[3].trim();
        if (!lhs) return { output: "bash: syntax error near unexpected token `<'", exitCode: 1 };
        const r = await this.fs.read(redirectFile);
        if (r.error) return { output: `bash: ${inputMatch[2]}: No such file or directory`, exitCode: 1 };
        const stdin = r.content ?? "";
        const cmdOutput = await this.execWithStdin(lhs, stdin);
        const lhsCmd = lhs.trim().split(/\s+/)[0];
        const exitCode2 = lhsCmd === "grep" && cmdOutput === "" ? 1 : this.exitCodeFor(cmdOutput);
        if (remainder) {
          const appendRem = remainder.match(/^>>\s*(\S+)$/);
          const writeRem = remainder.match(/^>\s*(\S+)$/);
          if (appendRem) {
            const outPath = this.resolve(appendRem[1]);
            const werr = this.checkWritable("bash", outPath);
            if (werr) return { output: werr, exitCode: 1 };
            const existing = await this.fs.read(outPath);
            const current = existing.error ? "" : existing.content ?? "";
            await this.fs.write(outPath, current + cmdOutput + "\n");
            return { output: "", exitCode: 0 };
          } else if (writeRem) {
            const outPath = this.resolve(writeRem[1]);
            const werr = this.checkWritable("bash", outPath);
            if (werr) return { output: werr, exitCode: 1 };
            await this.fs.write(outPath, cmdOutput + "\n");
            return { output: "", exitCode: 0 };
          }
        }
        return { output: cmdOutput, exitCode: exitCode2 };
      }
      const appendMatch = trimmed.match(/^(.+?)>>\s*(\S+)$/);
      if (appendMatch) {
        const lhs = appendMatch[1].trim();
        const filePath = this.resolve(appendMatch[2]);
        const werr = this.checkWritable("echo", filePath);
        if (werr) return { output: werr, exitCode: 1 };
        const output2 = await this.execSingle(lhs);
        const exitCode2 = this.exitCodeFor(output2);
        if (exitCode2 !== 0) return { output: output2, exitCode: exitCode2 };
        const existing = await this.fs.read(filePath);
        const current = existing.error ? "" : existing.content ?? "";
        await this.fs.write(filePath, current + output2 + "\n");
        return { output: "", exitCode: 0 };
      }
      const writeMatch = trimmed.match(/^(.+?)>\s*(\S+)$/);
      if (writeMatch) {
        const lhs = writeMatch[1].trim();
        const filePath = this.resolve(writeMatch[2]);
        const werr = this.checkWritable("echo", filePath);
        if (werr) return { output: werr, exitCode: 1 };
        const output2 = await this.execSingle(lhs);
        const exitCode2 = this.exitCodeFor(output2);
        if (exitCode2 !== 0) return { output: output2, exitCode: exitCode2 };
        await this.fs.write(filePath, output2 + "\n");
        return { output: "", exitCode: 0 };
      }
      if (trimmed.includes(" | ")) {
        const segments = trimmed.split(" | ");
        let output2 = "";
        let exitCode2 = 0;
        for (let i = 0; i < segments.length; i++) {
          if (i === 0) {
            const execResult = await this.execSingleWithError(segments[i].trim());
            output2 = execResult.output;
            if (execResult.hadError) {
              exitCode2 = this.exitCodeFor(output2);
              output2 = "";
            }
          } else {
            output2 = await this.execWithStdin(segments[i].trim(), output2);
            const segCmd = segments[i].trim().split(/\s+/)[0];
            if (exitCode2 === 0) {
              if (segCmd === "grep" && output2 === "") exitCode2 = 1;
              else if (this.isErrorOutput(output2)) exitCode2 = this.exitCodeFor(output2);
            }
          }
        }
        if (exitCode2 === 0) exitCode2 = this.exitCodeFor(output2);
        return { output: output2, exitCode: exitCode2 };
      }
      const output = await this.execSingle(trimmed);
      const cmd = trimmed.split(/\s+/)[0];
      const exitCode = cmd === "grep" && output === "" ? 1 : this.exitCodeFor(output);
      return { output, exitCode };
    }
    async jobs_cmd(_args) {
      if (this.jobs.size === 0) return "";
      return [...this.jobs.values()].map((j) => `[${j.id}] ${j.status.padEnd(9)} ${j.command}`).join("\n");
    }
    async fg(args) {
      let id;
      if (!args[0]) {
        id = Math.max(...this.jobs.keys());
        if (!isFinite(id)) return "fg: current: no such job";
      } else {
        id = parseInt(args[0].replace("%", ""));
      }
      if (isNaN(id) || !this.jobs.has(id)) return `fg: ${args[0] ?? ""}: no such job`;
      const job = this.jobs.get(id);
      const result = await job.promise;
      this.jobs.delete(id);
      return result.output;
    }
    async bg(args) {
      const id = parseInt((args[0] ?? "").replace("%", ""));
      if (isNaN(id) || !this.jobs.has(id)) return `bg: ${args[0] ?? ""}: no such job`;
      return "";
    }
    exitCodeFor(output) {
      const first = output.trimStart().split("\n")[0];
      if (/\bcommand not found\b/.test(first)) return 2;
      if (/\b(missing operand|missing pattern|Invalid regular expression)\b/.test(first)) return 2;
      if (/^\w[\w-]*: .+: .+/.test(first)) return 1;
      return 0;
    }
    async execSingle(command) {
      const parts = this.parseArgs(command);
      const [cmd, ...args] = parts;
      switch (cmd) {
        case "ls":
          return this.ls(args);
        case "cat":
          return this.cat(args);
        case "grep":
          return this.grep(args);
        case "find":
          return this.find(args);
        case "pwd":
          return this.cwd;
        case "cd":
          return this.cd(args[0]);
        case "mkdir":
          return this.mkdir(args);
        case "rm":
          return this.rm(args);
        case "mv":
          return this.mv(args);
        case "cp":
          return this.cp(args);
        case "echo":
          return args.join(" ");
        case "export": {
          const expr = args.join(" ");
          const m = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
          if (m) {
            this.env.set(m[1], m[2]);
            return "";
          }
          return "export: not supported";
        }
        case "touch":
          return this.touch(args[0]);
        case "head":
          return this.head(args);
        case "tail":
          return this.tail(args);
        case "wc":
          return this.wc(args);
        case "jobs":
          return this.jobs_cmd(args);
        case "fg":
          return this.fg(args);
        case "bg":
          return this.bg(args);
        default:
          return `${cmd}: command not found`;
      }
    }
    async execSingleWithError(command) {
      const parts = this.parseArgs(command);
      const [cmd, ...args] = parts;
      switch (cmd) {
        case "cat": {
          const expanded = await this.expandPathArgs(args);
          const paths = expanded.filter((a) => !a.startsWith("-"));
          if (!paths.length) return { output: "cat: missing operand", hadError: true };
          const results = await Promise.all(paths.map(async (p) => {
            if (/[*?]/.test(p)) return { text: `cat: ${p}: No such file or directory`, err: true };
            const r = await this.fs.read(this.resolve(p));
            return r.error ? { text: this.fsError("cat", p, r.error), err: true } : { text: r.content ?? "", err: false };
          }));
          const hadError = results.some((r) => r.err);
          return { output: results.map((r) => r.text).join("\n"), hadError };
        }
        case "echo":
          return { output: args.join(" "), hadError: false };
        case "pwd":
          return { output: this.cwd, hadError: false };
        default: {
          const output = await this.execSingle(command);
          return { output, hadError: this.isErrorOutput(output) };
        }
      }
    }
    async execWithStdin(command, stdin) {
      const parts = this.parseArgs(command);
      const [cmd, ...args] = parts;
      if (cmd === "wc") {
        const flags = args.filter((a) => a.startsWith("-"));
        const lines = stdin === "" ? 0 : stdin.split("\n").length;
        const words = stdin.split(/\s+/).filter(Boolean).length;
        const chars = stdin.length;
        if (flags.includes("-l")) return String(lines);
        if (flags.includes("-w")) return String(words);
        if (flags.includes("-c")) return String(chars);
        return `${lines}	${words}	${chars}`;
      }
      if (cmd === "grep") {
        const rawFlags = args.filter((a) => a.startsWith("-"));
        const rest = args.filter((a) => !a.startsWith("-"));
        const flags = [];
        for (const f of rawFlags) {
          if (f.length > 2 && f.startsWith("-")) {
            for (let i = 1; i < f.length; i++) flags.push("-" + f[i]);
          } else {
            flags.push(f);
          }
        }
        const [pattern] = rest;
        if (!pattern) return "grep: missing pattern";
        const caseInsensitive = flags.includes("-i");
        let regex;
        try {
          regex = new RegExp(pattern, caseInsensitive ? "i" : "");
        } catch {
          return `grep: ${pattern}: Invalid regular expression`;
        }
        const lines = stdin.split("\n").filter((l) => regex.test(l));
        if (!lines.length) return "";
        if (flags.includes("-l")) return lines.length ? "(stdin)" : "";
        if (flags.includes("-c")) return String(lines.length);
        return lines.join("\n");
      }
      return this.execSingle(command);
    }
    checkWritable(cmd, path) {
      if (this.fs.readOnly === true) return `${cmd}: ${path}: Permission denied`;
      return null;
    }
    isErrorOutput(output) {
      return /^\w+: .+: .+/.test(output.trimStart().split("\n")[0]);
    }
    fsError(cmd, path, err) {
      if (err?.toLowerCase().includes("not found") || err?.toLowerCase().includes("no such"))
        return `${cmd}: ${path}: No such file or directory`;
      return `${cmd}: ${path}: ${err}`;
    }
    normalizePath(path) {
      const parts = path.split("/").filter(Boolean);
      const stack = [];
      for (const part of parts) {
        if (part === "..") {
          if (stack.length) stack.pop();
        } else if (part !== ".") stack.push(part);
      }
      return "/" + stack.join("/");
    }
    resolve(path) {
      if (!path || path === ".") return this.cwd;
      const raw = path.startsWith("/") ? path : (this.cwd === "/" ? "" : this.cwd) + "/" + path;
      return this.normalizePath(raw);
    }
    parseArgs(cmd) {
      const parts = [];
      let cur = "", inQ = false, q = "";
      for (const ch of cmd) {
        if (inQ) {
          if (ch === q) inQ = false;
          else cur += ch;
        } else if (ch === '"' || ch === "'") {
          inQ = true;
          q = ch;
        } else if (ch === " ") {
          if (cur) {
            parts.push(cur);
            cur = "";
          }
        } else cur += ch;
      }
      if (cur) parts.push(cur);
      return parts;
    }
    matchGlob(name, pattern) {
      let re = "";
      let i = 0;
      while (i < pattern.length) {
        const ch = pattern[i];
        if (ch === "[") {
          const close = pattern.indexOf("]", i + 1);
          if (close !== -1) {
            let bracket = pattern.slice(i, close + 1);
            if (bracket.length > 3 && bracket[1] === "!") {
              bracket = "[^" + bracket.slice(2);
            }
            re += bracket;
            i = close + 1;
            continue;
          }
        }
        if (ch === "*") {
          re += ".*";
          i++;
          continue;
        }
        if (ch === "?") {
          re += ".";
          i++;
          continue;
        }
        re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        i++;
      }
      return new RegExp("^" + re + "$").test(name);
    }
    async expandRecursiveGlob(baseDir, pattern) {
      const results = [];
      const visited = /* @__PURE__ */ new Set();
      const stack = [baseDir];
      while (stack.length) {
        const dir = stack.pop();
        if (visited.has(dir)) continue;
        visited.add(dir);
        let entries;
        try {
          entries = await this.fs.ls(dir);
        } catch {
          continue;
        }
        for (const e of entries) {
          const fullPath = dir === "/" ? "/" + e.name : dir + "/" + e.name;
          if (e.type === "dir") {
            stack.push(fullPath);
          }
          if (this.matchGlob(e.name, pattern)) {
            results.push(fullPath);
          }
        }
      }
      return results;
    }
    async expandGlob(pattern, dir) {
      if (!/[*?[]/.test(pattern)) return [pattern];
      const doubleStarIdx = pattern.indexOf("**");
      if (doubleStarIdx !== -1) {
        const before = pattern.slice(0, doubleStarIdx).replace(/\/$/, "");
        const after = pattern.slice(doubleStarIdx + 2).replace(/^\//, "");
        const baseDir = before ? this.resolve(before) : dir;
        const matchPattern = after || "*";
        return this.expandRecursiveGlob(baseDir, matchPattern);
      }
      const entries = await this.fs.ls(dir);
      return entries.filter((e) => e.type === "file" && this.matchGlob(e.name, pattern)).map((e) => dir === "/" ? "/" + e.name : dir + "/" + e.name);
    }
    async expandPathArgs(args) {
      const result = [];
      for (const a of args) {
        if (a.startsWith("-") || !/[*?[]/.test(a)) {
          result.push(a);
          continue;
        }
        const matches = await this.expandGlob(a, this.cwd);
        if (matches.length) result.push(...matches);
        else result.push(a);
      }
      return result;
    }
    async ls(args) {
      const long = args.includes("-l") || args.includes("-la") || args.includes("-al");
      const all = args.includes("-a") || args.includes("-la") || args.includes("-al");
      const pageIdx = args.indexOf("--page");
      const page = pageIdx !== -1 ? parseInt(args[pageIdx + 1]) : null;
      const sizeIdx = args.indexOf("--page-size");
      const pageSize = sizeIdx !== -1 ? parseInt(args[sizeIdx + 1]) : 20;
      const flagArgs = /* @__PURE__ */ new Set(["-l", "-a", "-la", "-al", "--page", "--page-size"]);
      const flagValues = /* @__PURE__ */ new Set();
      if (pageIdx !== -1 && args[pageIdx + 1]) flagValues.add(args[pageIdx + 1]);
      if (sizeIdx !== -1 && args[sizeIdx + 1]) flagValues.add(args[sizeIdx + 1]);
      const pathArg = args.find((a) => !a.startsWith("-") && !flagValues.has(a));
      if (pathArg && /[*?[]/.test(pathArg)) {
        const matches = await this.expandGlob(pathArg, this.cwd);
        if (!matches.length) return `ls: ${pathArg}: No such file or directory`;
        return matches.map((p) => p.split("/").pop()).join("\n");
      }
      const path = pathArg || this.cwd;
      let lsResult;
      try {
        lsResult = await this.fs.ls(this.resolve(path));
      } catch (err) {
        return this.fsError("ls", path, err.message ?? String(err));
      }
      if (lsResult && lsResult.error) return this.fsError("ls", path, lsResult.error);
      let entries = lsResult;
      if (all) {
        const hasDot = entries.some((e) => e.name === ".");
        const hasDotDot = entries.some((e) => e.name === "..");
        const synthetic = [];
        if (!hasDot) synthetic.push({ name: ".", type: "dir" });
        if (!hasDotDot) synthetic.push({ name: "..", type: "dir" });
        entries = [...synthetic, ...entries];
      } else {
        entries = entries.filter((e) => !e.name.startsWith("."));
      }
      if (page !== null) {
        const validPage = Math.max(1, page);
        const validPageSize = pageSize > 0 ? pageSize : 20;
        const start = (validPage - 1) * validPageSize;
        const end = start + validPageSize;
        entries = entries.slice(start, end);
      }
      if (!entries.length) return "";
      if (long) {
        return entries.map((e) => `${e.type === "dir" ? "d" : "-"}rwxr-xr-x  ${e.name}`).join("\n");
      }
      return entries.map((e) => e.type === "dir" ? e.name + "/" : e.name).join("\n");
    }
    async cat(args) {
      const expanded = await this.expandPathArgs(args);
      const paths = expanded.filter((a) => !a.startsWith("-"));
      if (!paths.length) return "cat: missing operand";
      const results = await Promise.all(paths.map(async (p) => {
        if (/[*?]/.test(p)) return `cat: ${p}: No such file or directory`;
        const r = await this.fs.read(this.resolve(p));
        return r.error ? this.fsError("cat", p, r.error) : r.content ?? "";
      }));
      return results.join("\n");
    }
    async grep(args) {
      const rawFlags = args.filter((a) => a.startsWith("-"));
      const rest = args.filter((a) => !a.startsWith("-"));
      const [pattern, ...paths] = rest;
      if (!pattern) return "grep: missing pattern";
      const flags = [];
      for (const f of rawFlags) {
        if (f.length > 2 && f.startsWith("-")) {
          for (let i = 1; i < f.length; i++) flags.push("-" + f[i]);
        } else {
          flags.push(f);
        }
      }
      try {
        new RegExp(pattern, flags.includes("-i") ? "i" : "");
      } catch {
        return `grep: ${pattern}: Invalid regular expression`;
      }
      const recursive = flags.includes("-r") || flags.includes("-R");
      const expandedPaths = [];
      for (const p of paths) {
        if (/[*?]/.test(p)) {
          const matches = await this.expandGlob(p, this.cwd);
          expandedPaths.push(...matches);
        } else {
          expandedPaths.push(p);
        }
      }
      if (paths.length > 0 && expandedPaths.length === 0)
        return `grep: ${paths[0]}: No such file or directory`;
      const resolvedPaths = expandedPaths.length ? expandedPaths : paths;
      if (resolvedPaths.length === 1 && !recursive) {
        const singlePath = resolvedPaths[0];
        try {
          const raw = await this.grepStream(pattern, singlePath, flags);
          const warning = raw[0]?.startsWith("grep: warning:") ? raw[0] : void 0;
          const matches = warning ? raw.slice(1) : raw;
          if (flags.includes("-c")) return (warning ? warning + "\n" : "") + String(matches.length);
          if (!matches.length) return warning ?? "";
          if (flags.includes("-l")) return (warning ? warning + "\n" : "") + singlePath;
          return raw.join("\n");
        } catch (err) {
          return this.fsError("grep", singlePath, String(err));
        }
      }
      if (resolvedPaths.length > 1 && !recursive && isStreamable(this.fs)) {
        const allMatches = [];
        for (const p of resolvedPaths) {
          try {
            const raw = await this.grepStream(pattern, p, flags);
            allMatches.push(...raw.filter((m) => !m.startsWith("grep: warning:")));
          } catch (err) {
            allMatches.push(this.fsError("grep", p, String(err)));
          }
        }
        if (flags.includes("-c")) return String(allMatches.length);
        if (!allMatches.length) return "";
        if (flags.includes("-l")) return [...new Set(allMatches.map((m) => m.split(":")[0]))].join("\n");
        return allMatches.join("\n");
      }
      const caseInsensitive = flags.includes("-i");
      if (caseInsensitive && (resolvedPaths.length > 0 || recursive)) {
        const regex = new RegExp(pattern, "i");
        const files = [];
        const searchDirs = resolvedPaths.length ? resolvedPaths : [this.cwd];
        for (const p of searchDirs) {
          const resolved = this.resolve(p);
          let isDir = false;
          try {
            await this.fs.ls(resolved);
            isDir = true;
          } catch {
          }
          if (isDir) {
            if (recursive) {
              const collected = await this.findRecursive(resolved, void 0, "f");
              files.push(...collected);
            } else {
              return `grep: ${p}: is a directory`;
            }
          } else {
            files.push(resolved);
          }
        }
        const ciResults = [];
        for (const file of files) {
          const r = await this.fs.read(file);
          if (r.error) continue;
          const lines = (r.content ?? "").split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              ciResults.push({ path: file, line: i + 1, content: lines[i] });
            }
          }
        }
        if (flags.includes("-c")) return String(ciResults.length);
        if (!ciResults.length) {
          for (const p of searchDirs) {
            const resolved = this.resolve(p);
            let lsThrew = false;
            try {
              await this.fs.ls(resolved);
            } catch {
              lsThrew = true;
            }
            if (lsThrew) return this.fsError("grep", p, "No such file or directory");
          }
          return "";
        }
        if (flags.includes("-l")) return [...new Set(ciResults.map((r) => r.path))].join("\n");
        return ciResults.map((r) => `${r.path}:${r.line}: ${r.content}`).join("\n");
      }
      const allResults = await this.fs.grep(pattern);
      const searchPaths = resolvedPaths.length ? resolvedPaths : recursive ? [this.cwd] : [];
      const pathFiltered = searchPaths.length ? allResults.filter((r) => searchPaths.some((p) => r.path.startsWith(this.resolve(p)))) : allResults;
      const filtered = caseInsensitive ? (() => {
        const re = new RegExp(pattern, "i");
        return pathFiltered.filter((r) => re.test(r.content));
      })() : pathFiltered;
      if (flags.includes("-c")) return String(filtered.length);
      if (!filtered.length) {
        for (const p of searchPaths) {
          const resolved = this.resolve(p);
          let lsThrew = false;
          try {
            await this.fs.ls(resolved);
          } catch {
            lsThrew = true;
          }
          if (lsThrew) return this.fsError("grep", p, "No such file or directory");
        }
        return "";
      }
      if (flags.includes("-l")) return [...new Set(filtered.map((r) => r.path))].join("\n");
      return filtered.map((r) => `${r.path}:${r.line}: ${r.content}`).join("\n");
    }
    async grepStream(pattern, path, flags) {
      const resolved = this.resolve(path);
      let regex;
      try {
        regex = new RegExp(pattern, flags.includes("-i") ? "i" : "");
      } catch {
        throw new Error(`${pattern}: Invalid regular expression`);
      }
      if (isStreamable(this.fs)) {
        const matches2 = [];
        let lineNum = 0;
        for await (const line of this.fs.readStream(resolved)) {
          lineNum++;
          if (regex.test(line)) matches2.push(`${resolved}:${lineNum}: ${line}`);
        }
        return matches2;
      }
      const WARNING = "grep: warning: streaming unavailable, using read() fallback";
      const r = await this.fs.read(resolved);
      if (r.error) throw new Error(r.error);
      const lines = (r.content ?? "").split("\n");
      const matches = [];
      lines.forEach((line, idx) => {
        if (regex.test(line)) matches.push(`${resolved}:${idx + 1}: ${line}`);
      });
      return [WARNING, ...matches];
    }
    async findRecursive(basePath, namePattern, typeFilter, visited = /* @__PURE__ */ new Set()) {
      if (visited.has(basePath)) return [];
      visited.add(basePath);
      let entries;
      try {
        entries = await this.fs.ls(basePath);
      } catch {
        return [];
      }
      const results = [];
      for (const e of entries) {
        const fullPath = basePath.replace(/\/$/, "") + "/" + e.name;
        const matchesType = !typeFilter || e.type === (typeFilter === "f" ? "file" : "dir");
        const matchesName = !namePattern || namePattern.test(e.name);
        if (matchesType && matchesName) results.push(fullPath);
        if (e.type === "dir") results.push(...await this.findRecursive(fullPath, namePattern, typeFilter, visited));
      }
      return results;
    }
    async find(args) {
      const nameIdx = args.indexOf("-name");
      const typeIdx = args.indexOf("-type");
      const namePatternStr = nameIdx !== -1 ? args[nameIdx + 1] : void 0;
      const typeFilter = typeIdx !== -1 ? args[typeIdx + 1] : void 0;
      const basePath = args[0]?.startsWith("-") ? this.cwd : args[0] || this.cwd;
      const nameRegex = namePatternStr ? new RegExp("^" + namePatternStr.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$") : void 0;
      const results = await this.findRecursive(this.resolve(basePath), nameRegex, typeFilter);
      return results.join("\n");
    }
    async cd(path) {
      if (!path || path === "~") {
        this.cwd = "/";
        this.env.set("PWD", "/");
        return "";
      }
      const resolved = this.resolve(path);
      try {
        await this.fs.ls(resolved);
      } catch {
        return `cd: ${path}: No such file or directory`;
      }
      const r = await this.fs.read(resolved);
      if (!r.error && r.content !== void 0) return `cd: ${path}: Not a directory`;
      this.cwd = resolved;
      this.env.set("PWD", resolved);
      return "";
    }
    parentOf(path) {
      const parts = path.replace(/\/$/, "").split("/");
      parts.pop();
      return parts.join("/") || "/";
    }
    async mkdirOne(resolved) {
      if (typeof this.fs.mkdir === "function") {
        await this.fs.mkdir(resolved);
      } else {
        await this.fs.write(resolved + "/.keep", "");
      }
    }
    async mkdir(args) {
      const recursive = args.includes("-p");
      const paths = args.filter((a) => !a.startsWith("-"));
      const err = this.checkWritable("mkdir", this.resolve(paths[0] ?? ""));
      if (err) return err;
      for (const p of paths) {
        const resolved = this.resolve(p);
        if (recursive) {
          const segments = resolved.replace(/^\//, "").split("/");
          let prefix = "";
          for (const seg of segments) {
            prefix += "/" + seg;
            try {
              await this.mkdirOne(prefix);
            } catch {
            }
          }
        } else {
          try {
            await this.fs.ls(this.parentOf(resolved));
          } catch {
            return `mkdir: ${p}: No such file or directory`;
          }
          try {
            await this.mkdirOne(resolved);
          } catch (e) {
            const msg = e.message ?? String(e);
            if (msg.toLowerCase().includes("exist"))
              return `mkdir: ${p}: File exists`;
            return `mkdir: ${p}: No such file or directory`;
          }
        }
      }
      return "";
    }
    async rmRecursive(path) {
      const stack = [path];
      const toDelete = [];
      const visited = /* @__PURE__ */ new Set();
      while (stack.length) {
        const cur = stack.pop();
        if (visited.has(cur)) continue;
        visited.add(cur);
        toDelete.push(cur);
        const entries = await this.fs.ls(cur);
        for (const e of entries) {
          const child = cur.replace(/\/$/, "") + "/" + e.name;
          if (e.type === "dir") stack.push(child);
          else toDelete.push(child);
        }
      }
      for (let i = toDelete.length - 1; i >= 0; i--) {
        await this.fs.delete(toDelete[i]);
      }
    }
    async rm(args) {
      const recursive = args.includes("-r") || args.includes("-rf");
      const expanded = await this.expandPathArgs(args);
      const paths = expanded.filter((a) => !a.startsWith("-"));
      if (paths.length === 0) return "rm: missing operand";
      const werr = this.checkWritable("rm", this.resolve(paths[0] ?? ""));
      if (werr) return werr;
      for (const p of paths) {
        const resolved = this.resolve(p);
        if (resolved === "/") return "rm: refusing to remove '/'";
        if (recursive) {
          try {
            await this.rmRecursive(resolved);
          } catch (e) {
            return this.fsError("rm", p, e.message ?? String(e));
          }
        } else {
          const r = await this.fs.read(resolved);
          if (r.error && /no such file/i.test(r.error)) return this.fsError("rm", p, "No such file or directory");
          let lsThrew = false;
          try {
            await this.fs.ls(resolved);
          } catch {
            lsThrew = true;
          }
          if (!lsThrew) return `rm: ${p}: is a directory`;
          try {
            await this.fs.delete(resolved);
          } catch (e) {
            return this.fsError("rm", p, e.message ?? String(e));
          }
        }
      }
      return "";
    }
    async mv(args) {
      const [src, dst] = args.filter((a) => !a.startsWith("-"));
      if (!src || !dst) return "mv: missing operand";
      const srcPath = this.resolve(src);
      const dstPath = this.resolve(dst);
      const werr = this.checkWritable("mv", srcPath);
      if (werr) return werr;
      let isDir = false;
      try {
        await this.fs.ls(srcPath);
        isDir = true;
      } catch {
      }
      if (isDir) {
        const copyErr = await this.copyRecursive(srcPath, dstPath);
        if (copyErr) return copyErr;
        try {
          await this.rmRecursive(srcPath);
        } catch (e) {
          return this.fsError("mv", src, e.message ?? String(e));
        }
        return "";
      } else {
        const r = await this.fs.read(srcPath);
        if (r.error) return this.fsError("mv", src, r.error);
        await this.fs.write(dstPath, r.content ?? "");
        await this.fs.delete(srcPath);
        return "";
      }
    }
    async cp(args) {
      const flags = args.filter((a) => a.startsWith("-"));
      const recursive = flags.includes("-r") || flags.includes("-R");
      const [src, dst] = args.filter((a) => !a.startsWith("-"));
      if (!src || !dst) return "cp: missing operand";
      const werr = this.checkWritable("cp", this.resolve(dst));
      if (werr) return werr;
      if (/[*?]/.test(src)) {
        const matches = await this.expandGlob(src, this.cwd);
        if (!matches.length) return `cp: ${src}: No such file or directory`;
        for (const m of matches) {
          const name = m.split("/").pop();
          const dstPath = this.resolve(dst) + "/" + name;
          const r2 = await this.fs.read(m);
          if (r2.error) return this.fsError("cp", m, r2.error);
          await this.fs.write(dstPath, r2.content ?? "");
        }
        return "";
      }
      if (recursive) return this.copyRecursive(this.resolve(src), this.resolve(dst));
      try {
        await this.fs.ls(this.resolve(src));
        return `cp: ${src}: -r not specified; omitting directory`;
      } catch {
      }
      const r = await this.fs.read(this.resolve(src));
      if (r.error) return this.fsError("cp", src, r.error);
      await this.fs.write(this.resolve(dst), r.content ?? "");
      return "";
    }
    async copyRecursive(src, dst) {
      let entries;
      try {
        entries = await this.fs.ls(src);
      } catch (err) {
        return this.fsError("cp", src, String(err));
      }
      if (typeof this.fs.mkdir === "function") {
        try {
          await this.fs.mkdir(dst);
        } catch {
        }
      }
      for (const entry of entries) {
        const srcPath = src + "/" + entry.name;
        const dstPath = dst + "/" + entry.name;
        if (entry.type === "dir") {
          const err = await this.copyRecursive(srcPath, dstPath);
          if (err) return err;
        } else {
          const r = await this.fs.read(srcPath);
          if (r.error) return this.fsError("cp", srcPath, r.error);
          await this.fs.write(dstPath, r.content ?? "");
        }
      }
      return "";
    }
    async touch(path) {
      if (!path) return "touch: missing operand";
      const werr = this.checkWritable("touch", this.resolve(path));
      if (werr) return werr;
      const r = await this.fs.read(this.resolve(path));
      if (r.content === void 0 || r.content === null) await this.fs.write(this.resolve(path), "");
      return "";
    }
    async head(args) {
      const nIdx = args.indexOf("-n");
      const n = nIdx !== -1 ? parseInt(args[nIdx + 1]) : 10;
      const path = args.find((a) => !a.startsWith("-") && !/^\d+$/.test(a));
      if (!path) return "head: missing operand";
      const r = await this.fs.read(this.resolve(path));
      if (r.error) return this.fsError("head", path, r.error);
      return (r.content ?? "").split("\n").slice(0, n).join("\n");
    }
    async tail(args) {
      const nIdx = args.indexOf("-n");
      const n = nIdx !== -1 ? parseInt(args[nIdx + 1]) : 10;
      const path = args.find((a) => !a.startsWith("-") && !/^\d+$/.test(a));
      if (!path) return "tail: missing operand";
      const r = await this.fs.read(this.resolve(path));
      if (r.error) return this.fsError("tail", path, r.error);
      const lines = (r.content ?? "").split("\n");
      return lines.slice(-n).join("\n");
    }
    async wc(args) {
      const flags = args.filter((a) => a.startsWith("-"));
      const path = args.find((a) => !a.startsWith("-"));
      if (!path) return "wc: missing operand";
      const r = await this.fs.read(this.resolve(path));
      if (r.error) return this.fsError("wc", path, r.error);
      const content = r.content ?? "";
      const lines = content === "" ? 0 : content.split("\n").length;
      const words = content.split(/\s+/).filter(Boolean).length;
      const chars = content.length;
      if (flags.includes("-l")) return `${lines}	${path}`;
      if (flags.includes("-w")) return `${words}	${path}`;
      if (flags.includes("-c")) return `${chars}	${path}`;
      return `${lines}	${words}	${chars}	${path}`;
    }
  };

  // src/browser.ts
  var MemFS = class {
    files = /* @__PURE__ */ new Map();
    dirs = /* @__PURE__ */ new Set(["/"]);
    normalize(p) {
      return p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    }
    async read(path) {
      const f = this.files.get(this.normalize(path));
      if (f === void 0) throw new Error(`ENOENT: ${path}`);
      return f;
    }
    async write(path, content) {
      const p = this.normalize(path);
      const dir = p.split("/").slice(0, -1).join("/") || "/";
      this.dirs.add(dir);
      this.files.set(p, content);
    }
    async ls(path) {
      const p = this.normalize(path);
      const entries = [];
      const prefix = p === "/" ? "/" : p + "/";
      for (const [fp] of this.files) {
        if (fp.startsWith(prefix) && !fp.slice(prefix.length).includes("/"))
          entries.push({ name: fp.slice(prefix.length), type: "file", size: this.files.get(fp).length });
      }
      for (const dp of this.dirs) {
        if (dp !== p && dp.startsWith(prefix) && !dp.slice(prefix.length).includes("/"))
          entries.push({ name: dp.slice(prefix.length), type: "dir", size: 0 });
      }
      return entries;
    }
    async delete(path) {
      this.files.delete(this.normalize(path));
    }
    async mkdir(path) {
      this.dirs.add(this.normalize(path));
    }
    async exists(path) {
      const p = this.normalize(path);
      return this.files.has(p) || this.dirs.has(p);
    }
    async grep(pattern, path, opts) {
      const re = new RegExp(pattern);
      const results = [];
      const check = async (fp) => {
        const content = this.files.get(fp);
        if (!content) return;
        content.split("\n").forEach((line, i) => {
          if (re.test(line)) results.push({ file: fp, line: i + 1, content: line });
        });
      };
      const p = this.normalize(path);
      if (this.files.has(p)) {
        await check(p);
      } else if (opts?.recursive) {
        for (const fp of this.files.keys()) if (fp.startsWith(p + "/")) await check(fp);
      }
      return results;
    }
  };
  function createBrowserShell(existingFs) {
    const fs = existingFs || new MemFS();
    return new AgenticShell(fs);
  }
  return __toCommonJS(browser_exports);
})();

if (typeof AgenticShellBrowser !== 'undefined' && typeof AgenticShell === 'undefined') { var AgenticShell = AgenticShellBrowser; }

// ═══ agentic-voice.js ═══
(function(e,t){typeof exports==`object`&&typeof module<`u`?t(exports):typeof define==`function`&&define.amd?define([`exports`],t):(e=typeof globalThis<`u`?globalThis:e||self,t(e.AgenticVoice={}))})(this,function(e){Object.defineProperty(e,Symbol.toStringTag,{value:`Module`});var t=((e,t)=>()=>(t||(e((t={exports:{}}).exports,t),e=null),t.exports))(((e,t)=>{t.exports={}}));function n(){let e={};return{on(t,n){return e[t]||(e[t]=[]),e[t].push(n),this},off(t,n){return e[t]&&(e[t]=e[t].filter(e=>e!==n)),this},emit(t,...n){if(e[t])for(let r of e[t])try{r(...n)}catch(e){console.error(`[voice]`,e)}}}}async function r(e){let t=new(globalThis.AudioContext||globalThis.webkitAudioContext),n=await e.arrayBuffer(),r=await t.decodeAudioData(n),i=r.getChannelData(0),a=r.sampleRate,o=new ArrayBuffer(44+i.length*2),s=new DataView(o),c=(e,t)=>{for(let n=0;n<t.length;n++)s.setUint8(e+n,t.charCodeAt(n))};c(0,`RIFF`),s.setUint32(4,36+i.length*2,!0),c(8,`WAVE`),c(12,`fmt `),s.setUint32(16,16,!0),s.setUint16(20,1,!0),s.setUint16(22,1,!0),s.setUint32(24,a,!0),s.setUint32(28,a*2,!0),s.setUint16(32,2,!0),s.setUint16(34,16,!0),c(36,`data`),s.setUint32(40,i.length*2,!0);for(let e=0;e<i.length;e++){let t=Math.max(-1,Math.min(1,i[e]));s.setInt16(44+e*2,t<0?t*32768:t*32767,!0)}return t.close(),new Blob([o],{type:`audio/wav`})}function i(e){return(e||``).trim().replace(/\/+$/,``).replace(/\/v1$/,``)}function a(e={}){let{provider:t=`openai`,baseUrl:n=`https://api.openai.com`,apiKey:r=``,model:a=`tts-1`,voice:o=`alloy`,format:s=`mp3`,proxyUrl:c=null,core:l=null}=e,u=null,d=null,f=0,p=null,m=0,h=0,g=null,_=null;function v(){return u||=new(globalThis.AudioContext||globalThis.webkitAudioContext),u}function y(){p&&=(cancelAnimationFrame(p),null)}function b(){y(),m=0,h=0}async function x(e,u={}){if(!e?.trim()||!r&&!u.apiKey)return null;if(l?.synthesize)return l.synthesize(e,{provider:u.provider||t,baseUrl:u.baseUrl||n,apiKey:u.apiKey||r,proxyUrl:u.proxyUrl||c,model:u.model||a,voice:u.voice||o,format:u.format||s});if((u.provider||t)===`elevenlabs`){let t=u.voice||o,n=u.model||a||`eleven_turbo_v2_5`,i=`https://api.elevenlabs.io/v1/text-to-speech/${t}`,s={"xi-api-key":u.apiKey||r,"Content-Type":`application/json`},c=JSON.stringify({text:e,model_id:n,voice_settings:{stability:.5,similarity_boost:.75}}),l,d;for(let e=0;e<3;e++)try{l=await fetch(i,{method:`POST`,headers:s,body:c});break}catch(t){d=t,e<2&&await new Promise(t=>setTimeout(t,500*(e+1)))}if(!l)throw d;if(!l.ok)throw Error(`ElevenLabs TTS failed: ${l.status} ${l.statusText}`);let f=await l.arrayBuffer();return f.byteLength===0?null:f}let d=`${i(u.baseUrl||n)}/v1/audio/speech`,f=c||d,p={Authorization:`Bearer ${u.apiKey||r}`,"Content-Type":`application/json`};c&&(p[`X-Target-URL`]=d);let m=JSON.stringify({model:u.model||a,voice:u.voice||o,input:e,response_format:u.format||s}),h,g;for(let e=0;e<3;e++)try{h=await fetch(f,{method:`POST`,headers:p,body:m});break}catch(t){g=t,e<2&&await new Promise(t=>setTimeout(t,500*(e+1)))}if(!h)throw g;if(!h.ok)throw Error(`TTS failed: ${h.status} ${h.statusText}`);let _=await h.arrayBuffer();return _.byteLength===0?null:_}async function S(e){if(++f,T(),b(),!e||e.byteLength===0)return console.error(`[TTS] Invalid arrayBuffer`),null;console.log(`[TTS] Playing buffer, size:`,e.byteLength);let t=new Blob([e],{type:`audio/mpeg`}),n=URL.createObjectURL(t),r=new Audio;return r.src=n,new Promise(e=>{r.onloadedmetadata=()=>{h=r.duration},r.ontimeupdate=()=>{r.duration>0&&(m=r.currentTime/r.duration,g?.({progress:m,duration:r.duration,elapsed:r.currentTime}))},r.onended=()=>{URL.revokeObjectURL(n),m=1,g?.({progress:1,duration:h,elapsed:h}),d=null,_?.(),e({duration:h})},r.onerror=t=>{console.error(`[TTS] Audio error:`,r.error),URL.revokeObjectURL(n),d=null,_?.(),e(null)},d=r,r.play().catch(t=>{console.error(`[TTS] Play failed:`,t),URL.revokeObjectURL(n),e(null)})})}async function C(e,n={}){if(!e?.trim())return!1;if(!r&&!n.apiKey)throw Error(`TTS apiKey required`);let i=++f;if(T(),b(),(n.provider||t)===`elevenlabs`){let t=n.voice||o,i=n.model||a||`eleven_turbo_v2_5`,s=`https://api.elevenlabs.io/v1/text-to-speech/${t}`,c=await fetch(s,{method:`POST`,headers:{"xi-api-key":n.apiKey||r,"Content-Type":`application/json`},body:JSON.stringify({text:e,model_id:i,voice_settings:{stability:.5,similarity_boost:.75}})});if(console.log(`[TTS] Fetch response:`,c.status,c.ok),!c.ok)return!1;let l=await c.arrayBuffer();console.log(`[TTS] Got arrayBuffer:`,l.byteLength,`bytes`);let u=new Blob([l],{type:`audio/mpeg`}),f=URL.createObjectURL(u);console.log(`[TTS] Created blob URL:`,f);let p=new Audio;return p.src=f,console.log(`[TTS] Audio element created, src set`),new Promise(e=>{p.onended=()=>{console.log(`[TTS] Audio ended`),URL.revokeObjectURL(f),d=null,_?.(),e(!0)},p.onerror=t=>{console.error(`[TTS] Audio error:`,p.error),URL.revokeObjectURL(f),e(!1)},d=p,p.play().catch(t=>{console.error(`[TTS] Play failed:`,t),e(!1)})})}let s=await x(e,n);return!s||i!==f?!1:!!await S(s)}async function w(e,t={}){let a=await x(e,t);if(!a)return null;let o=i(t.baseUrl||n),c=t.apiKey||r;if(!o||!c)return null;try{let e=new Blob([a],{type:`audio/${s}`}),t=new FormData;t.append(`file`,e,`speech.${s}`),t.append(`model`,`whisper-1`),t.append(`response_format`,`verbose_json`),t.append(`timestamp_granularities[]`,`word`);let n=await fetch(`${o}/v1/audio/transcriptions`,{method:`POST`,headers:{Authorization:`Bearer ${c}`},body:t});if(!n.ok)return null;let r=await n.json();return r.words?.length?{words:r.words,duration:r.duration,audio:a}:null}catch{return null}}function T(){if(f++,y(),d){try{d.stop?d.stop():d.pause&&d.pause()}catch{}d=null}b()}async function E(e,t={}){let n=++f;T();let r=``,i=/[.!?。！？]\s*/;for await(let a of e){if(f!==n)break;r+=a;let e=r.split(i);r=e.pop()||``;for(let r of e)if(r.trim()){if(f!==n)break;await C(r.trim(),t),await new Promise(e=>{let t=setInterval(()=>{(!d||f!==n)&&(clearInterval(t),e())},50)})}}r.trim()&&f===n&&await C(r.trim(),t)}function D(){let e=v();e.state===`suspended`&&e.resume()}function O(){if(T(),u)try{u.close()}catch{}u=null}return{speak:C,speakStream:E,fetchAudio:x,playBuffer:S,timestamps:w,stop:T,unlock:D,destroy:O,onProgress(e){g=e},onEnd(e){_=e},get isSpeaking(){return!!d},get progress(){return m},get duration(){return h},get generation(){return f},bumpGeneration(){return++f}}}function o(e={}){let{provider:n=`openai`,baseUrl:a=`https://api.openai.com`,apiKey:o=``,language:s=`zh-CN`,model:c=`whisper-1`,proxyUrl:l=null,minHoldMs:u=300,core:d=null}=e,f=null,p=0,m=!1;function h(e){let t=e.sampleRate,n=e.getChannelData(0),r=new Int16Array(n.length);for(let e=0;e<n.length;e++)r[e]=Math.max(-1,Math.min(1,n[e]))*32767;let i=new ArrayBuffer(44+r.length*2),a=new DataView(i),o=(e,t)=>{for(let n=0;n<t.length;n++)a.setUint8(e+n,t.charCodeAt(n))};o(0,`RIFF`),a.setUint32(4,36+r.length*2,!0),o(8,`WAVE`),o(12,`fmt `),a.setUint32(16,16,!0),a.setUint16(20,1,!0),a.setUint16(22,1,!0),a.setUint32(24,t,!0),a.setUint32(28,t*1*2,!0),a.setUint16(32,2,!0),a.setUint16(34,16,!0),o(36,`data`),a.setUint32(40,r.length*2,!0);for(let e=0;e<r.length;e++)a.setInt16(44+e*2,r[e],!0);return new Blob([i],{type:`audio/wav`})}function g(e,t){return console.log(`[STT] startWhisper called, mediaRecorder:`,f),f?!1:(p=Date.now(),m=!1,navigator.mediaDevices?.getUserMedia?(navigator.mediaDevices.getUserMedia({audio:!0}).then(n=>{if(console.log(`[STT] Got media stream`),m){console.log(`[STT] Mic already released, stopping stream`),n.getTracks().forEach(e=>e.stop());return}let r=[];f=new MediaRecorder(n,{mimeType:`audio/webm`}),console.log(`[STT] MediaRecorder created`),f.ondataavailable=e=>{console.log(`[STT] Data available:`,e.data.size,`bytes`),r.push(e.data)},f.onstop=async()=>{console.log(`[STT] MediaRecorder stopped`),n.getTracks().forEach(e=>e.stop());let i=Date.now()-p;if(console.log(`[STT] Held for`,i,`ms`),f=null,i<u)return;let a=new Blob(r,{type:`audio/webm`});console.log(`[STT] Created blob:`,a.size,`bytes`);try{let n=await v(a);console.log(`[STT] Transcribe result:`,n),n?e?.(n):t?.(Error(`No speech detected`))}catch(e){console.error(`[STT] Transcribe error:`,e),t?.(e)}},f.start(),console.log(`[STT] Recording started`)}).catch(e=>{console.error(`[STT] getUserMedia error:`,e),t?.(Error(`Microphone unavailable: `+e.message))}),!0):(t?.(Error(`getUserMedia not available (HTTPS required)`)),!1))}function _(){m=!0,f&&f.state===`recording`&&f.stop(),f=null}async function v(e,u={}){let f=u.provider||n,p=u.apiKey||o;if(!p)throw Error(`STT apiKey required`);if(d?.transcribe)return d.transcribe(e,{provider:f,baseUrl:u.baseUrl||a,apiKey:p,proxyUrl:u.proxyUrl||l,model:u.model||c,language:u.language||s,timestamps:u.timestamps||!1});if(f===`elevenlabs`){let n=`https://api.elevenlabs.io/v1/speech-to-text`,r=u.model||`scribe_v2`;if(globalThis.window===void 0&&(typeof e==`string`||Buffer.isBuffer(e))){let i=t(),a=typeof e==`string`?i.readFileSync(e):e,o=`----AgenticVoice`+Date.now().toString(36),s=[];s.push(`--${o}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`),s.push(a),s.push(`\r\n--${o}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\n${r}\r\n`),s.push(`--${o}--\r\n`);let c=Buffer.concat(s.map(e=>typeof e==`string`?Buffer.from(e):e)),l=t(),u=new(t()).URL(n);return new Promise((e,t)=>{let n=l.request({hostname:u.hostname,path:u.pathname,method:`POST`,headers:{"xi-api-key":p,"Content-Type":`multipart/form-data; boundary=${o}`,"Content-Length":c.length},timeout:3e4},n=>{let r=``;n.on(`data`,e=>r+=e),n.on(`end`,()=>{try{e(JSON.parse(r).text?.trim()||``)}catch{t(Error(`Failed to parse ElevenLabs response`))}})});n.on(`error`,t),n.on(`timeout`,()=>{n.destroy(),t(Error(`Transcription timeout`))}),n.write(c),n.end()})}console.log(`[STT] Transcribing audio blob, size:`,e.size),console.log(`[STT] Converting webm to wav...`);try{let t=new AudioContext({sampleRate:16e3}),i=await e.arrayBuffer(),a=await t.decodeAudioData(i);console.log(`[STT] Decoded:`,a.duration.toFixed(2)+`s`);let o=h(a);console.log(`[STT] WAV created:`,o.size,`bytes`);let s=new FormData;s.append(`file`,o,`audio.wav`),s.append(`model_id`,r),console.log(`[STT] Sending WAV to ElevenLabs...`);let c=await fetch(n,{method:`POST`,headers:{"xi-api-key":p},body:s});if(console.log(`[STT] Response:`,c.status,c.ok),!c.ok){let e=await c.text();throw console.error(`[STT] Error response:`,e),Error(`ElevenLabs STT failed: ${c.status}`)}let l=await c.json();return console.log(`[STT] Result:`,l),l.text?.trim()||``}catch(e){throw console.error(`[STT] Error:`,e.name,e.message),e}}let m=i(u.baseUrl||a);if(!m)throw Error(`STT baseUrl required`);let g=`${m}/v1/audio/transcriptions`,_={Authorization:`Bearer ${p}`};if(globalThis.window===void 0&&(typeof e==`string`||Buffer.isBuffer(e))){let n=t(),r=typeof e==`string`?n.readFileSync(e):e,i=`----AgenticVoice`+Date.now().toString(36),a=[];a.push(`--${i}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`),a.push(r),a.push(`\r
`),a.push(`--${i}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${u.model||c}\r\n`),a.push(`--${i}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${s.split(`-`)[0]}\r\n`),u.timestamps&&(a.push(`--${i}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`),a.push(`--${i}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nword\r\n`)),a.push(`--${i}--\r\n`);let o=Buffer.concat(a.map(e=>typeof e==`string`?Buffer.from(e):e)),l=(g.startsWith(`https`),t()),d=new(t()).URL(g);return new Promise((e,t)=>{let n=l.request({hostname:d.hostname,port:d.port||(g.startsWith(`https`)?443:80),path:d.pathname,method:`POST`,headers:{..._,"Content-Type":`multipart/form-data; boundary=${i}`,"Content-Length":o.length},timeout:3e4},n=>{let r=``;n.on(`data`,e=>r+=e),n.on(`end`,()=>{try{let t=JSON.parse(r);u.timestamps?e(t):e(t.text?.trim()||``)}catch{t(Error(`Failed to parse transcription response`))}})});n.on(`error`,t),n.on(`timeout`,()=>{n.destroy(),t(Error(`Transcription timeout`))}),n.write(o),n.end()})}let v=await r(e),y=new FormData;y.append(`file`,v,`audio.wav`),y.append(`model`,u.model||c),y.append(`language`,s.split(`-`)[0]),u.timestamps&&(y.append(`response_format`,`verbose_json`),y.append(`timestamp_granularities[]`,`word`));let b=await fetch(g,{method:`POST`,headers:_,body:y});if(!b.ok)throw Error(`Transcription failed: ${b.status}`);if(!(b.headers.get(`content-type`)||``).includes(`json`))throw Error(`Transcription service unavailable`);let x=await b.json();return u.timestamps?x:x.text?.trim()||``}async function y(e,t={}){try{let n=await v(e,{...t,timestamps:!0});return n?.words?.length?{words:n.words,text:n.text||``,duration:n.duration}:null}catch{return null}}function b(e,t){return g(e,t)}function x(){_()}function S(){x()}return{startListening:b,stopListening:x,transcribe:v,transcribeWithTimestamps:y,destroy:S,get isListening(){return!!f}}}function s(e={}){let t=n(),r=e.tts===!1?null:a(e.tts||{}),i=e.stt===!1?null:o(e.stt||{});r&&(r.onProgress(e=>t.emit(`progress`,e)),r.onEnd(()=>t.emit(`playbackEnd`)));let s=!1;return{async speak(e,n){if(!r)throw Error(`TTS not configured`);if(i?.isListening)return!1;s=!0,t.emit(`speaking`,!0);try{return await r.speak(e,n)}finally{s=!1,t.emit(`speaking`,!1)}},async fetchAudio(e,t){if(!r)throw Error(`TTS not configured`);return r.fetchAudio(e,t)},async playBuffer(e){if(!r)throw Error(`TTS not configured`);s=!0,t.emit(`speaking`,!0);try{return await r.playBuffer(e)}finally{s=!1,t.emit(`speaking`,!1)}},async timestamps(e,t){if(!r)throw Error(`TTS not configured`);return r.timestamps(e,t)},stop(){r&&r.stop(),s=!1,t.emit(`speaking`,!1)},startListening(){if(!i)throw Error(`STT not configured`);r&&r.stop(),s=!1,t.emit(`listening`,!0),i.startListening(e=>{t.emit(`listening`,!1),t.emit(`transcript`,e)},e=>{t.emit(`listening`,!1),t.emit(`error`,e)})},stopListening(){i&&i.stopListening(),t.emit(`listening`,!1)},async transcribe(e,t){if(!i)throw Error(`STT not configured`);return i.transcribe(e,t)},async transcribeWithTimestamps(e,t){if(!i)throw Error(`STT not configured`);return i.transcribeWithTimestamps(e,t)},unlock(){r&&r.unlock()},on(e,n){return t.on(e,n),this},off(e,n){return t.off(e,n),this},get isSpeaking(){return s},get isListening(){return i?.isListening||!1},get progress(){return r?.progress||0},get duration(){return r?.duration||0},destroy(){r&&r.destroy(),i&&i.destroy()}}}e.createSTT=o,e.createTTS=a,e.createVoice=s});

// ═══ agentic.js ═══
(function(e,t){typeof exports==`object`&&typeof module<`u`?t(exports):typeof define==`function`&&define.amd?define([`exports`],t):(e=typeof globalThis<`u`?globalThis:e||self,t(e.Agentic={}))})(this,function(e){Object.defineProperty(e,Symbol.toStringTag,{value:`Module`});var t={};function n(e){if(t[e]!==void 0)return t[e];if(typeof window<`u`){let n=e.split(`-`).map(e=>e[0].toUpperCase()+e.slice(1)).join(``);if(window[n])return t[e]=window[n],t[e]}try{typeof require==`function`?t[e]=require(e):t[e]=null}catch{t[e]=null}return t[e]}var r=typeof WebSocket<`u`?WebSocket:typeof require==`function`?(()=>{try{return require(`ws`)}catch{return null}})():null;function i(e){let t=e.replace(/^http/,`ws`).replace(/\/+$/,``),n=null,i=!1,a=null,o=new Map,s=0;function c(){return a||(a=new Promise((e,s)=>{if(!r)return s(Error(`WebSocket not available`));n=new r(t),n.onopen=()=>{i=!0,a=null,e(n)},n.onmessage=e=>{let t;try{t=JSON.parse(typeof e.data==`string`?e.data:e.data.toString())}catch{return}if(t._reqId&&o.has(t._reqId)){let e=o.get(t._reqId);t.type===`rpc_result`?(e.resolve(t.result),o.delete(t._reqId)):t.type===`rpc_error`?(e.reject(Error(t.error||`RPC error`)),o.delete(t._reqId)):t.type===`chat_delta`?(e.chunks.push(t.text||``),e.onDelta&&e.onDelta(t.text||``)):t.type===`chat_end`?(e.resolve(t.text||e.chunks.join(``)),o.delete(t._reqId)):(t.type===`chat_error`||t.type===`error`)&&(e.reject(Error(t.error||`Unknown error`)),o.delete(t._reqId))}else if(t.type===`chat_delta`||t.type===`chat_end`||t.type===`chat_error`){let e=o.values().next().value;if(!e)return;let n=o.keys().next().value;t.type===`chat_delta`?(e.chunks.push(t.text||``),e.onDelta&&e.onDelta(t.text||``)):t.type===`chat_end`?(e.resolve(t.text||e.chunks.join(``)),o.delete(n)):t.type===`chat_error`&&(e.reject(Error(t.error||`Unknown error`)),o.delete(n))}},n.onerror=e=>{i||(a=null,s(e))},n.onclose=()=>{i=!1,a=null;for(let[e,t]of o)t.reject(Error(`WebSocket closed`));o.clear()}}),a)}async function l(e,t={}){(!i||!n||n.readyState!==1)&&await c();let r=`r_${++s}_${Date.now()}`;return new Promise((i,a)=>{o.set(r,{resolve:i,reject:a,chunks:[],onDelta:t.emit}),n.send(JSON.stringify({type:`think`,_reqId:r,messages:e,options:{tools:t.tools,prefer:t.prefer}}))})}function u(){n&&=(n.close(),null),i=!1,a=null}async function d(e,t={}){(!i||!n||n.readyState!==1)&&await c();let r=`r_${++s}_${Date.now()}`;return new Promise((i,a)=>{o.set(r,{resolve:i,reject:a,chunks:[],onDelta:null,_rpc:!0}),n.send(JSON.stringify({type:`rpc`,_reqId:r,method:e,params:t}))})}return{connect:c,chat:l,rpc:d,close:u,get connected(){return i}}}var a=class{constructor(e={}){this._opts=e,this._i={},this._serviceUrl=e.serviceUrl?e.serviceUrl.replace(/\/+$/,``):null,this._ws=this._serviceUrl?i(this._serviceUrl):null,this._cfg={};for(let t of[`llm`,`tts`,`stt`,`embed`])this._cfg[t]=e[t]||{}}_cfgFor(e,t){return this._cfg[e]?.[t]??this._opts[t]}_cfgAll(e){return{provider:this._cfgFor(e,`provider`),apiKey:this._cfgFor(e,`apiKey`),baseUrl:this._cfgFor(e,`baseUrl`),model:this._cfgFor(e,`model`),...this._cfg[e]}}_get(e,t){return this._i[e]||(this._i[e]=t()),this._i[e]}_need(e){let t=n(e);if(!t)throw Error(`${e} not installed — run: npm install ${e}`);return t}chat(e,t={}){let n=Array.isArray(e),r=n?e[e.length-1]?.content||``:e,i=n?e.slice(0,-1):t.history;if(this._ws){let a=n?e:i?[...i,{role:`user`,content:r}]:[{role:`user`,content:r}];return t.system&&a.unshift({role:`system`,content:t.system}),this._ws.chat(a,{tools:t.tools,emit:t.emit,prefer:t.prefer})}let a=this._need(`agentic-core`),o=a.agenticAsk||a,s=t.prefer,c=s&&typeof s==`object`?s:null,l=t.stream!==!1,u={provider:c?.provider||t.provider||this._cfgFor(`llm`,`provider`),baseUrl:c?.baseUrl||t.baseUrl||this._cfgFor(`llm`,`baseUrl`),apiKey:c?.key||t.apiKey||this._cfgFor(`llm`,`apiKey`),model:c?.model||t.model||this._cfgFor(`llm`,`model`),system:t.system||this._opts.system,stream:l,proxyUrl:t.proxyUrl||this._opts.proxyUrl};return t.tools&&(u.tools=t.tools),t.images&&(u.images=t.images),t.audio&&(u.audio=t.audio),i&&(u.history=i),t.schema&&(u.schema=t.schema),l?t.emit?o(r,u,t.emit):o(r,u):o(r,u,t.emit||(()=>{})).then(e=>typeof e==`string`?{answer:e}:{answer:e?.answer||e?.content||``,rounds:e?.rounds,messages:e?.messages,usage:e?.usage})}async think(e,t={}){if(t.stream&&t.emit)return this.chat(e,t);let n=await this.chat(e,{...t,stream:!1});return n?.answer??n}async step(e,t={}){let n=this._need(`agentic-core`);if(!n.agenticStep)throw Error(`agentic-core does not support step() — update to latest version`);let r={provider:t.provider||this._cfgFor(`llm`,`provider`),baseUrl:t.baseUrl||this._cfgFor(`llm`,`baseUrl`),apiKey:t.apiKey||this._cfgFor(`llm`,`apiKey`),model:t.model||this._cfgFor(`llm`,`model`),system:t.system||this._opts.system,stream:t.stream||!1,proxyUrl:t.proxyUrl||this._opts.proxyUrl,emit:t.emit};return t.tools&&(r.tools=t.tools),t.signal&&(r.signal=t.signal),n.agenticStep(e,r)}buildToolResults(e,t){let n=this._need(`agentic-core`);return n.buildToolResults?n.buildToolResults(e,t):e.map((e,n)=>{let r=t[n],i=r.error?JSON.stringify({error:r.error}):JSON.stringify(r.output??r);return{role:`tool`,tool_call_id:e.id,content:i}})}_core(){return n(`agentic-core`)}_tts(){return this._get(`tts`,()=>{let e=this._need(`agentic-voice`),t=this._cfgAll(`tts`);return e.createTTS({provider:t.provider||`openai`,baseUrl:t.baseUrl,apiKey:t.apiKey,voice:t.voice,model:t.model,core:this._core()})})}_hasVoice(){return!!n(`agentic-voice`)}async speak(e,t){if(this._ws){let n=await this._ws.rpc(`speak`,{text:e,options:t});if(typeof Buffer<`u`)return Buffer.from(n.audio,`base64`);let r=atob(n.audio),i=new Uint8Array(r.length);for(let e=0;e<r.length;e++)i[e]=r.charCodeAt(e);return i.buffer}return this._tts().fetchAudio(e,t)}async speakAloud(e,t){return this._tts().speak(e,t)}async speakStream(e,t){return this._tts().speakStream(e,t)}async timestamps(e,t){return this._tts().timestamps(e,t)}stopSpeaking(){this._i.tts&&this._i.tts.stop()}_stt(){return this._get(`stt`,()=>{let e=this._need(`agentic-voice`),t=this._cfgAll(`stt`);return e.createSTT({provider:t.provider||`openai`,baseUrl:t.baseUrl,apiKey:t.apiKey,model:t.model,core:this._core()})})}async listen(e,t){if(this._ws){let n=typeof e==`string`?e:typeof Buffer<`u`&&Buffer.isBuffer(e)?e.toString(`base64`):o(e);return(await this._ws.rpc(`listen`,{audio:n,options:t})).text}return this._stt().transcribe(e,t)}async listenWithTimestamps(e,t){return this._stt().transcribeWithTimestamps(e,t)}startListening(e,t){return this._stt().startListening(e,t)}stopListening(){this._i.stt&&this._i.stt.stopListening()}async see(e,t=`描述这张图片`,n={}){let r=typeof e==`string`?e:o(e);if(this._ws){let e=[{role:`user`,content:[{type:`text`,text:t},{type:`image_url`,image_url:{url:`data:image/jpeg;base64,${r}`}}]}];return(await this._ws.rpc(`see`,{messages:e,options:n})).text}return this.think(t,{...n,images:[{url:`data:image/jpeg;base64,${r}`}]})}async converse(e,t={}){let n=await this.listen(e),r=await this.think(n,t),i=typeof r==`string`?r:r.answer||``;return{text:i,audio:await this.speak(i),transcript:n}}_mem(){return this._get(`mem`,()=>this._need(`agentic-memory`).createMemory({knowledge:!0,...this._opts.memory}))}async remember(e,t={}){let n=t.id||`m_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;return await this._mem().learn(n,e,t),n}async recall(e,t){return this._mem().recall(e,t)}async addMessage(e,t){return this._mem().add(e,t)}async _store(){if(!this._i.store){let e=this._opts.store||{};if(e.instance)this._i.store=e.instance;else{let t=this._need(`agentic-store`),n=e.name||`agentic`,r=await t.createStore(n,e);this._i.store=r}}return this._i.store}async save(e,t){return(await this._store()).set(e,t)}async load(e){return(await this._store()).get(e)}async has(e){return(await this._store()).has(e)}async keys(){return(await this._store()).keys()}async deleteKey(e){return(await this._store()).delete(e)}async query(e,t){return(await this._store()).all(e,t)}async sql(e,t){return(await this._store()).run(e,t)}async exec(e,t){return(await this._store()).exec(e,t)}_embedLib(){return this._need(`agentic-embed`)}async _embedIndex(){return this._get(`embedIndex`,async()=>this._embedLib().create({...this._opts.embed}))}async embed(e){return this._ws?(await this._ws.rpc(`embed`,{text:Array.isArray(e)?e[0]:e})).embedding:this._embedLib().localEmbed(Array.isArray(e)?e:[e])[0]}async index(e,t,n){return(await this._embedIndex()).add(e,t,n)}async indexMany(e){return(await this._embedIndex()).addMany(e)}async search(e,t){return(await this._embedIndex()).search(e,t)}_sense(){return this._get(`sense`,()=>new(this._need(`agentic-sense`)).AgenticSense)}async perceive(e){return this._sense().detect(e)}_act(){let e=this._opts;return this._get(`act`,()=>new(this._need(`agentic-act`)).AgenticAct({apiKey:e.apiKey,model:e.model,baseUrl:e.baseUrl,provider:e.provider}))}async decide(e){return this._act().decide(e)}async act(e){return this._act().run(e)}createRenderer(e,t){return this._need(`agentic-render`).createRenderer(e,t)}_fs(){return this._get(`fs`,()=>{let e=this._need(`agentic-filesystem`),t=this._opts.fs||{},n=t.backend===`memory`?e.MemoryStorage:e.NodeFsBackend||e.MemoryStorage;return new e.AgenticFileSystem(n?new n(t):void 0)})}async readFile(e){let t=await this._fs().read(e);return t?.content===void 0?t:t.content}async writeFile(e,t){return this._fs().write(e,t)}async deleteFile(e){return this._fs().delete(e)}async ls(e){let t=await this._fs().ls(e);return Array.isArray(t)?t.map(e=>e?.name||e):t}async tree(e){return this._fs().tree(e)}async grep(e,t){return this._fs().grep(e,t)}async semanticGrep(e){return this._fs().semanticGrep(e)}_shell(){return this._get(`shell`,()=>new(this._need(`agentic-shell`)).AgenticShell(this._fs()))}async run(e){return this._shell().exec(e)}async reconstructSpace(e,t={}){let n=this._opts;return this._need(`agentic-spatial`).reconstructSpace({images:e,apiKey:n.apiKey,model:n.model,baseUrl:n.baseUrl,provider:n.provider,...t})}createSpatialSession(e={}){let t=this._opts;return new(this._need(`agentic-spatial`)).SpatialSession({apiKey:t.apiKey,model:t.model,baseUrl:t.baseUrl,provider:t.provider,...e})}createClaw(e={}){let t=this._need(`agentic-claw`),n=this._opts;return t.createClaw({apiKey:n.apiKey,provider:n.provider,baseUrl:n.baseUrl,model:n.model,systemPrompt:n.system,...e})}createConductor(e={}){let t=this._need(`agentic-conductor`),r=this._opts,i=this,a={chat(e,t={}){return i.chat(e,{system:t.system,tools:t.tools,stream:!0})}},o=e.store;if(!o)try{n(`agentic-store`)&&(o=null)}catch{}return t.createConductor({ai:a,systemPrompt:r.system||e.systemPrompt,...e,store:o})}get admin(){if(!this._ws)return null;let e=(e,t)=>this._ws.rpc(e,t);return this._get(`admin`,()=>({health:()=>e(`health`),status:()=>e(`status`),perf:()=>e(`perf`),config:t=>t?e(`config.set`,t):e(`config.get`),devices:()=>e(`devices`),models:()=>e(`models`),engines:()=>e(`engines`),queueStats:()=>e(`queue.stats`),assignments:t=>t?e(`assignments.set`,t):e(`assignments.get`),addToPool:t=>e(`pool.add`,t),removeFromPool:t=>e(`pool.remove`,{id:t})}))}capabilities(){let e=e=>!!n(e),t=!!this._ws;return{think:t||e(`agentic-core`),speak:t||e(`agentic-voice`),listen:t||e(`agentic-voice`),see:t||e(`agentic-core`),converse:(t||e(`agentic-core`))&&(t||e(`agentic-voice`)),remember:e(`agentic-memory`),recall:e(`agentic-memory`),save:e(`agentic-store`),load:e(`agentic-store`),embed:t||e(`agentic-embed`),search:e(`agentic-embed`),perceive:e(`agentic-sense`),decide:e(`agentic-act`),act:e(`agentic-act`),render:e(`agentic-render`),readFile:e(`agentic-filesystem`),run:e(`agentic-shell`),spatial:e(`agentic-spatial`),claw:e(`agentic-claw`),conductor:e(`agentic-conductor`),admin:t}}configure(e={}){Object.assign(this._opts,e);for(let t of[`llm`,`tts`,`stt`,`embed`])e[t]&&(this._cfg[t]={...this._cfg[t],...e[t]});return e.serviceUrl&&(this._serviceUrl=e.serviceUrl.replace(/\/+$/,``),this._ws&&this._ws.close(),this._ws=i(this._serviceUrl)),this._i={},this}get serviceUrl(){return this._serviceUrl}destroy(){this._ws&&=(this._ws.close(),null);for(let e of Object.values(this._i))e?.destroy?e.destroy():e?.close?e.close():e?.stopListening&&e.stopListening();this._i={}}};function o(e){if(typeof Buffer<`u`&&Buffer.isBuffer(e))return e.toString(`base64`);if(e instanceof ArrayBuffer){let t=new Uint8Array(e),n=``;for(let e=0;e<t.length;e++)n+=String.fromCharCode(t[e]);return typeof btoa==`function`?btoa(n):Buffer.from(n,`binary`).toString(`base64`)}return String(e)}var s=new a;e.Agentic=a,e.ai=s});
