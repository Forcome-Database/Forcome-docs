# Wiki AI Chat UX Polish Design

**Date:** 2026-03-23
**Status:** Approved for planning
**Scope:** Public wiki `AI Ask` panel interaction polish in the VitePress wiki frontend

---

## 1. Goal

Improve the wiki `AI Ask` panel so it feels like a reliable product feature instead of a functional prototype.

This phase focuses on frontend interaction quality:
- make the panel easier to start using
- make answering state easier to understand
- make sources easier to trust
- make history and recovery less disruptive

This phase does **not** redesign the retrieval pipeline again. It assumes the current backend source/citation fixes remain in place and uses the existing public wiki SSE API unless a small additive field is clearly necessary.

---

## 2. Current Problems

### 2.1 Welcome state is generic

The welcome view uses fixed suggestions and does not reflect the current page context, so first-use guidance is weak.

Current implementation:
- [AIChatWelcome.vue](e:/test/Docmost/wiki/docs/.vitepress/theme/components/AIChatWelcome.vue)

Observed issues:
- every page shows the same three prompts
- the panel does not explain whether answers come from the current page, related pages, or both
- the first action feels like “type anything” instead of a guided task

### 2.2 Composer is visually complete but interaction-light

The footer shows context, image previews, sender, and shortcut hints, but these pieces are stacked rather than coordinated.

Current implementation:
- [AIChat.vue](e:/test/Docmost/wiki/docs/.vitepress/theme/components/AIChat.vue#L771)
- [ai-chat.css](e:/test/Docmost/wiki/docs/.vitepress/theme/styles/ai-chat.css#L541)

Observed issues:
- the context tag is passive, not actionable
- the shortcut hint is always visible even when it is not the most important information
- loading state is mostly delegated to the sender; the panel does not clearly tell the user what is happening
- image attachment state is visible, but not integrated into the send affordance

### 2.3 Source display is too weak for trust-building

The current source module is correct structurally, but too subtle and too sparse to do trust work for the answer.

Current implementation:
- [AIChatSources.vue](e:/test/Docmost/wiki/docs/.vitepress/theme/components/AIChatSources.vue)
- [ai-chat.css](e:/test/Docmost/wiki/docs/.vitepress/theme/styles/ai-chat.css#L609)

Observed issues:
- sources are hidden behind a small disclosure control
- cards only show document title, not why the document was cited
- the UI does not distinguish between “current page grounding” and “retrieved related documents”
- users must click before they know whether the answer is actually grounded

### 2.4 History mode is disruptive

Switching to history replaces the whole message area, which breaks conversational continuity.

Current implementation:
- [AIChat.vue](e:/test/Docmost/wiki/docs/.vitepress/theme/components/AIChat.vue#L741)
- [ai-chat.css](e:/test/Docmost/wiki/docs/.vitepress/theme/styles/ai-chat.css#L820)

Observed issues:
- current conversation disappears while browsing history
- the user is moved into a different mode instead of getting a lightweight picker
- history entry preview is useful, but the switch cost is too high

### 2.5 Recovery states are present but not productized

The panel has an inline error box and retry button, but failure recovery still feels technical.

Current implementation:
- [ai-chat.css](e:/test/Docmost/wiki/docs/.vitepress/theme/styles/ai-chat.css#L505)

Observed issues:
- errors are generic and visually detached from the message that failed
- retry exists, but the panel does not clearly frame whether it will retry the same question or regenerate a fresh answer
- the interaction model for “stop”, “retry”, and “regenerate” is not clearly separated

---

## 3. Approaches Considered

### Approach A: CSS-only polish

Adjust spacing, borders, and hover states while keeping structure unchanged.

Pros:
- fastest to ship
- low regression risk

Cons:
- does not solve guidance, trust, or recovery problems
- improves appearance more than behavior

Decision: rejected as insufficient.

### Approach B: Incremental interaction polish on the current architecture

Keep the existing `AIChat.vue` architecture for now, add small focused UI components, and improve state presentation without changing the panel’s product boundary.

Pros:
- solves the highest-value interaction issues
- can be delivered in one implementation plan
- keeps risk low while preparing for future decomposition

Cons:
- does not fully fix the large-file structure problem in `AIChat.vue`
- some backend-driven state richness is deferred

Decision: **recommended**.

### Approach C: Full information architecture redesign

Split the panel into tabs/subviews, redesign history, source evidence, composer, and onboarding together.

Pros:
- best long-term UX ceiling
- allows a cleaner component model

Cons:
- too large for one safe iteration
- likely to mix UX work with architecture refactor and new backend contracts

Decision: defer until after the incremental polish phase lands.

---

## 4. Chosen Design

This phase adopts **Approach B** and introduces five improvements:

1. contextual welcome prompts
2. a dynamic composer status bar
3. a stronger source summary strip
4. a lighter-weight history drawer
5. clearer recovery actions

Each improvement is designed to be independently understandable and testable.

---

## 5. UX Design Details

### 5.1 Contextual welcome state

Replace static suggestions with page-aware suggestions derived from the current page title and panel context.

Behavior:
- if `pageTitle` exists, generate three prompts using that title
- if `pageTitle` does not exist, fall back to generic prompts
- show one short line explaining the grounding mode:
  - “优先基于当前页面回答”
  - if current implementation also retrieves related pages, add “必要时补充相关公开文档”

Example prompts:
- `总结这页的核心内容`
- `提取这页里的关键步骤`
- `这页提到了哪些相关文档或资源`

Why:
- reduces blank-state hesitation
- aligns first action with page QA instead of general chat

### 5.2 Dynamic composer status bar

Replace the always-on shortcut sentence with a compact status row above or below the sender.

The row should adapt by state:

- idle with page context:
  - `当前上下文：<page title>`
- idle with images:
  - `已附加 2 张图片`
- generating:
  - `正在生成回答...`
- after failure:
  - `本次回答失败，可重试或修改问题后重发`

The shortcut hint should not disappear entirely, but should move to a lower-emphasis treatment:
- show as subdued helper text only when the input is idle and empty
- hide it while loading or when error guidance is more important

Why:
- puts the most relevant system feedback closest to the send action
- reduces visual clutter during active work

### 5.3 Source summary strip

Keep the existing expandable source list, but add a visible one-line summary before the disclosure.

Example summary patterns:
- `答案基于当前页面与 2 篇相关文档`
- `答案基于 3 篇相关文档`
- `答案仅基于当前页面`

Expanded state improvements:
- keep page sources as the only visible card type in public wiki source UI
- add a short secondary label per card when possible:
  - `当前页面`
  - `相关文档`
- if a snippet is not available from backend, do not fake one

Why:
- trust begins before expansion
- users immediately know whether the answer is grounded narrowly or broadly

### 5.4 History drawer instead of hard mode switch

Change history from full content replacement to a lightweight overlay drawer inside the panel.

Behavior:
- current chat remains visually present beneath a right-to-left or fade-in drawer
- drawer contains the existing history list
- selecting an entry closes the drawer and loads that conversation
- closing the drawer returns to the current conversation without context loss

Why:
- history browsing becomes reversible
- users stop feeling like they left the chat to enter a different screen

### 5.5 Recovery actions

Clarify three different actions:

- `停止生成`
  - only visible while streaming
- `重试`
  - retries the last failed request payload
- `重新生成`
  - available on completed assistant messages when applicable

This phase only requires `停止生成` and `重试` if `重新生成` would require broader request-state retention than currently exists.

Failure presentation:
- bind the error to the most recent failed interaction
- keep the global inline error surface, but visually tie it to the latest answer block or composer state row

Why:
- different user intents need different controls
- makes failures recoverable without guesswork

---

## 6. Component and State Design

### 6.1 New or changed frontend units

#### `AIChatWelcome`

Responsibility:
- render the empty state
- accept page-aware prompt data
- show grounding hint

Inputs:
- `pageTitle?: string`
- `isConfigured: boolean`
- `modifierKey: string`
- `suggestions: string[]`
- `groundingHint?: string`

#### `AIChatSources`

Responsibility:
- normalize current page and related page citations into a source summary and expandable list

Inputs:
- `sources?: AiSource[]`
- `citations?: AiCitation[]`
- optional normalized metadata for summary labels

Outputs:
- visible summary strip
- expandable page-only source cards for public wiki

#### `AIChatHistoryDrawer`

Responsibility:
- display history as an overlay drawer instead of replacing the whole message region

Inputs:
- `entries`
- `currentRoutePath`
- `open`

Events:
- `close`
- `select`

This can begin as a small extracted component or remain inline if extraction would create more churn than value. The responsibility boundary must still be clear.

#### Composer status state

This does not need its own file initially, but it does need an explicit computed view model in `AIChat.vue` or a dedicated composable.

Suggested derived state:
- `mode: 'idle' | 'loading' | 'error' | 'image-ready'`
- `label: string`
- `showShortcutHint: boolean`

### 6.2 Data contract stance

This phase should prefer existing data and avoid new backend dependencies unless strictly necessary.

Allowed additive backend contract change:
- an optional citation/category hint if frontend cannot infer “current page” vs “related page” cleanly

Explicitly out of scope for this phase:
- retrieval progress SSE stages
- snippet extraction contract changes
- attachment/source rendering redesign beyond current public wiki page-only display rule

---

## 7. Visual and Interaction Rules

### 7.1 Hierarchy

- source summary should be visible but quieter than answer text
- status row should be stronger than keyboard-help text
- history drawer should feel secondary to the current conversation

### 7.2 Motion

- keep current panel enter/leave motion
- add subtle drawer transition for history
- avoid loading spinners in multiple places at once
- when streaming, prefer one clear active state near the composer instead of scattered activity indicators

### 7.3 Accessibility

- source toggle must expose `aria-expanded`
- history drawer must trap focus while open if it behaves as a modal sublayer
- close and back actions must remain keyboard accessible
- loading/error status text should be readable by assistive technology where practical

### 7.4 Mobile behavior

- retain full-width panel on mobile
- ensure history drawer uses the full available panel width on small screens
- do not let the status row or context tag wrap into a visually noisy stack when the keyboard is open

---

## 8. Error Handling

This design must treat error handling as a first-class interaction, not a fallback banner.

Requirements:
- failed send should still leave the prior user question visible
- retry should target the failed request, not a blank new message
- aborting a stream should not look like a transport error
- if AI returns “insufficient information”, that is a normal answer state, not an error state

Non-goal:
- deep transport diagnostics in the UI

---

## 9. Testing Requirements

### 9.1 Component behavior

- welcome prompts change when `pageTitle` changes
- source summary text changes correctly for:
  - current-page-only
  - current page + related pages
  - related-pages-only
- history drawer opens and closes without destroying current conversation view
- status row changes correctly across idle, loading, image-ready, and error states

### 9.2 Interaction behavior

- clicking a welcome suggestion sends the correct prompt
- while streaming, stop action is visible and retry is hidden
- after failure, retry is visible and status text updates
- source toggle announces expanded/collapsed state

### 9.3 Regression coverage

- current public wiki answer flow still renders message content and page sources correctly
- image upload preview still works
- mobile panel width and scroll behavior do not regress

---

## 10. Acceptance Criteria

- opening `AI Ask` on a documentation page shows page-aware onboarding instead of generic onboarding
- the composer communicates the current state without relying on a permanent shortcut sentence
- users can tell, before expanding details, whether an answer is grounded in the current page, related pages, or both
- opening history no longer feels like leaving the conversation
- failed answers provide a clear recovery path

---

## 11. Non-Goals

This design does not include:
- another RAG retrieval architecture change
- attachment download source cards in the public wiki UI
- multi-tab conversation management
- thumbs up/down feedback
- full component decomposition of `AIChat.vue`

Those can be addressed in later phases if this polish phase succeeds.

---

## 12. Risks and Mitigations

### Risk: UI scope expands into backend redesign

Mitigation:
- restrict this phase to frontend-first improvements
- treat backend contract additions as optional and additive only

### Risk: `AIChat.vue` becomes harder to maintain during polish

Mitigation:
- extract only the new units with clear value, such as history drawer or source summary helpers
- avoid mixing cosmetic refactors with behavior changes

### Risk: source summary overstates certainty

Mitigation:
- only state what current citation data can justify
- do not fabricate snippets, sections, or grounding claims

---

## 13. Ready-for-Planning Notes

The implementation plan should be split into small tasks with TDD discipline and should likely proceed in this order:

1. contextual welcome prompts
2. composer status row
3. source summary strip
4. history drawer
5. recovery action cleanup

That order maximizes user-facing value while minimizing interaction risk.
