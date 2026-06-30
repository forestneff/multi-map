---
name: how-todo
description: Execute TODO Roadmap tasks step-by-step with safety checks and atomic commits.
---

## Description
This skill defines the strict operating procedure for reading, interpreting, and executing tasks from the `TODO` file in the Multi-Map repository. It ensures atomic commits, prevents context-window thrashing, and maintains accurate project tracking.

## Trigger
Use this skill whenever the user requests to "work on the TODO," "start the next task," or "continue with the roadmap."

## Execution Workflow

### Step 1: Task Selection & Context Bounding
1. Read the `TODO` file located at the root of the project.
2. Identify the first incomplete task (marked with `[ ]`). Never skip phases. You must complete Phase 1 before moving to Phase 2.
3. Identify the Agent Context listed under the current Phase header.
4. **Context Management**: Start by loading the specific files listed in the "Agent Context" and the specific task details. Adopt a "start here, only expand as needed" approach. You may read additional unlisted files if it becomes necessary to understand dependencies or complete the task, but avoid reading the entire codebase blindly.

### Step 2: Planning & Approval
1. Formulate a brief, step-by-step execution plan based only on the task details provided in the `TODO` file.
2. If the task requires updating a schema (e.g., `mapstate-schema.json`), explicitly state the intended schema changes.
3. Present this plan to the user for approval before writing any code.

### Step 3: Atomic Execution
1. Execute the approved plan.
2. Make targeted, localized changes. Do not refactor adjacent code unless it explicitly breaks due to your changes.
3. If writing UI components, strictly adhere to the existing CSS methodologies found in `multi-map-ui.css` and `multi-map-base.css`.
4. If writing database logic, ensure changes strictly comply with `firestore.rules`.

### Step 4: Verification
1. Review the generated code against the original "Intent" and "Details" outlined in the `TODO` file.
2. Ensure no standard keyboard events (Step 11) or core logic (`multi-map-core.js`) have been inadvertently overridden.
3. Ask for input and/or offer suggestions to resolve conflicts and ambiguities that arise.

### Step 5: Self-Tracking (Updating the Roadmap)
1. Once the code is implemented and verified by the user, you MUST update the `TODO` file.
2. Change the status of the completed task from `[ ]` to `[x]`.
3. Do not alter the text, numbering, or intent of the completed task.
4. Announce completion and ask the user if they are ready to proceed to the next task.

## Anti-Patterns (Do NOT do these)
- **Scope Creep**: Do not implement features from future tasks. If you are on Task 2, do not write code for Task 3.
- **Context Overload**: Do not blindly load the entire codebase. While you can expand your context beyond the "Agent Context" as needed, avoid loading unneeded HTML, CSS, and Database rules simultaneously to preserve your context window.
- **Ghost Updates**: Never claim a task is done without physically updating the `[ ]` checkbox in `TODO` file.
