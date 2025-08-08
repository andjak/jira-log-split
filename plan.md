# Jira Smart Work Log - Implementation Plan (v2)

This document outlines the step-by-step plan to create an advanced Chrome extension for automatically logging work in Jira. The plan is based on the detailed user specification and emphasizes a Test-Driven Development (TDD) approach, Clean Code principles, and a robust architecture to handle complexity.

---

## Phase 1: Project Foundation & Core Services (Backend)

This phase establishes the project's technical foundation. Given the ongoing `npm` configuration issues, **Step 1.1 is the immediate priority before any other coding can begin.**

### Step 1.1: Environment & Project Scaffolding
- **Goal:** Resolve environment issues and create the basic project structure.
- **Tasks:**
    1.  **Resolve NPM Configuration:** Systematically diagnose and fix the `npm` registry issue to ensure dependencies can be installed from the public registry. This is a blocker for all subsequent steps.
    2.  **Initialize Project:** Use Vite to create a new TypeScript project once the npm issue is resolved.
    3.  **Setup Testing Framework:** Configure Vitest (a modern test runner compatible with Vite) for unit testing.
    4.  **Directory Structure:** Create the placeholder directories: `src/background`, `src/popup`, `src/services`, `src/core`, `src/ui`, and `tests`.
    5.  **Initial Manifest:** Create a `manifest.json` with basic properties (name, version) and initial permissions (`storage`, `activeTab`).

### Step 1.2: Advanced Settings Service
- **Goal:** Create a robust service to manage all user-configurable settings.
- **TDD Cycle:**
    1.  **Test (Red):** Write tests for getting and setting each new configuration option (e.g., `getWorkdayHours`, `getIssueSourceType`). Mock `chrome.storage.local`.
    2.  **Implement (Green):** Create `SettingsService` with methods for every setting defined in the spec (working day length, default period, issue source, distribution logic, exclusions, etc.). Use a single storage key for all settings to simplify management.
    3.  **Refactor:** Ensure clean, type-safe code for all getters and setters.

### Step 1.3: Jira API Service
- **Goal:** Encapsulate all communication with the Jira REST API.
- **TDD Cycle:**
    1.  **Test (Red):** Write tests for fetching issues, activity, and worklogs.
    2.  **Implement (Green):** Create `JiraApiService` with methods:
        -   `fetchIssues(jql: string)`: For the main issue list.
        -   `getIssueActivity(issueIds: string[])`: To fetch comments and status changes for the "distribute by activity" feature. This will likely involve inspecting the `changelog` of an issue.
        -   `getExistingWorklogs(issueIds: string[], start: Date, end: Date)`: To get currently logged time.
        -   `logWork(...)` and `updateWorklog(...)`: To save hours to Jira.
    3.  **Refactor:** Use constants for API endpoints and implement robust error handling.

---

## Phase 2: The Core Logic Engine (Backend)

This is the heart of the application. We'll build it as a set of independent, testable modules that can be orchestrated to produce the final worklog schedule.

### Step 2.1: Calculation Context Service
- **Goal:** Create a service that calculates the *available time* for any given day. This service is critical as it centralizes the complex daily time calculation.
- **TDD Cycle:**
    1.  **Test (Red):** Write tests for `getAvailableHours(date)` under various conditions:
        -   A day with a public holiday (0 hours).
        -   A day with a 3-hour vacation (5 hours available, assuming an 8-hour day).
        -   A day with meetings (e.g., 8h - 1.5h meetings = 6.5h available).
        -   A day with existing Jira worklogs.
        -   A combination of all the above.
    2.  **Implement (Green):** Create `CalculationContextService`. It will consume data from the `SettingsService` (workday length), a new `HolidayService` (for public holidays), and the application's state (user-entered vacations, meetings, and existing worklogs).
    3.  **Refactor:** Keep the service pure; it should take the necessary data as input and return a calculated result without side effects.

### Step 2.2: Issue Provider Service
- **Goal:** Create a service responsible for fetching the correct list of Jira issues based on the user's settings.
- **TDD Cycle:**
    1.  **Test (Red):** Write a test for `getIssues(period)` that returns a mock list of issues based on a "My Profile" setting, and another test for the "Changed status or commented" setting.
    2.  **Implement (Green):** Create `IssueProviderService`. It will use the `JiraApiService` and `SettingsService` to determine which JQL to run and whether to perform the additional filtering based on issue activity.
    3.  **Refactor:** Ensure exclusion logic (projects, issue types) is applied correctly.

### Step 2.3: Worklog Distribution Strategies
- **Goal:** Implement the two distinct time distribution algorithms using a Strategy design pattern.
- **TDD Cycle:**
    1.  **Define `DistributionStrategy` Interface:** Create an interface with a `distribute(issues, context)` method.
    2.  **Implement `EvenDistributionStrategy`:**
        -   **Test (Red):** Write tests for the "distribute evenly" logic: continuous logging for each ticket, correct rounding to 5-minute intervals, and handling of the remainder.
        -   **Implement (Green):** Write the logic as described in the spec.
    3.  **Implement `ActivityDistributionStrategy`:**
        -   **Test (Red):** Write tests for the "distribute based on activity" logic: time is logged on the day of activity, and fallback logic works correctly.
        -   **Implement (Green):** Write the logic as described.

### Step 2.4: The Main Worklog Engine
- **Goal:** Create the central orchestrator that ties all the backend services together.
- **TDD Cycle:**
    1.  **Test (Red):** Write high-level integration tests for the engine itself.
        -   Test that it correctly uses the selected strategy.
        -   Test the `recalculate` logic: ensure manually edited cells are "protected."
        -   Test the `clear` logic with its different checkbox options.
    2.  **Implement (Green):** Create the `WorklogEngine`. It will:
        -   Use the `IssueProviderService` to get issues.
        -   Use the `CalculationContextService` to get available time.
        -   Apply the chosen `DistributionStrategy`.
        -   Manage the state of the worklog grid, including which cells are manual vs. automatic.
    3.  **Refactor:** Ensure a clean separation of concerns between the engine and the services it uses.

---

## Phase 3: Frontend UI & Advanced Interactivity

This phase focuses on building the highly interactive and complex user interface. We will use a modern framework like **React or Svelte** and a **virtualized list library** to ensure high performance.

### Step 3.1: UI Component & State Foundation
- **Goal:** Build the core UI components and set up a robust state management solution.
- **Tasks:**
    1.  **Choose Framework:** Select a UI framework (e.g., React with TypeScript).
    2.  **State Management:** Choose a state library (e.g., Zustand or Redux Toolkit) to manage the complex UI state (the grid data, manual edits, saved statuses, UI settings).
    3.  **Component Library:** Create the individual, reusable UI components: `DataTable`, `StickyHeader`, `DateCell`, `IssueRow`, `MeetingRow`, `VacationRow`, `SettingsPage`.
    4.  **Virtualization:** Integrate a library like `React-Window` or `TanStack Virtual` into the `DataTable` to ensure smooth scrolling with large amounts of data.

### Step 3.2: Implementing Core UI Logic
- **Goal:** Bring the UI to life by connecting it to the backend engine and implementing user interactions.
- **Tasks:**
    1.  **Data Rendering:** Connect the main UI to the `WorklogEngine`. On load or on date change, call the engine and render the resulting schedule in the virtualized grid.
    2.  **Visual States:** Implement the visual indicators for cells (green line for saved, yellow for manual, half-and-half) and rows (yellow line for manually added).
    3.  **Event Handling:** Wire up all UI controls:
        -   The period selector.
        -   The "Distribute" and "Clear" buttons.
        -   The "Add Row" and "Remove Row" buttons.
        -   The "Save All" and "Save Row" buttons.

### Step 3.3: Implementing Advanced Interactivity
- **Goal:** Implement the complex, nuanced UI behaviors that define the user experience.
- **Tasks:**
    1.  **Manual Editing:** Implement the detailed logic for clicking cells (auto-fill empty cells, select content in filled cells), keyboard navigation (Tab, Enter, Esc), and unit parsing (`8`, `1.5h`, `30m`).
    2.  **Drag-to-Fill:** Implement the logic for dragging to add or remove hours across multiple days.
    3.  **Sticky Scrolling:** Implement the custom sticky header and subsection header logic, including the "sum of hidden rows" feature.
    4.  **Web Workers:** To prevent UI blocking, move the calls to the `WorklogEngine`'s distribution methods into a Web Worker.

---

## Phase 4: Final Assembly, Polishing, and Release

### Step 4.1: Error Handling & Offline Support
- **Goal:** Make the application resilient and reliable.
- **Tasks:**
    1.  **Optimistic UI:** When the user clicks "Save", update the UI immediately to show a "saved" state.
    2.  **Retry Queue:** If a Jira API call fails (e.g., due to network issues), add it to a queue and retry automatically in the background.
    3.  **Toaster Notifications:** Display clear, non-blocking notifications for success and failure events.
    4.  **Local Backup:** Periodically save the current state of the grid to `chrome.storage.local` to prevent data loss if the popup is accidentally closed.

### Step 4.2: Final Integration Testing & QA
- **Goal:** Perform end-to-end testing of the complete application.
- **Tasks:**
    1.  Test all user flows defined in the specification on a live Jira instance.
    2.  Test all edge cases (e.g., months with no workdays, more hours logged than available).
    3.  Test the loading behavior when the user is not logged into Jira.
    4.  Verify performance with large data sets.

### Step 4.3: Internationalization & Release
- **Goal:** Prepare the extension for a wider audience.
- **Tasks:**
    1.  Externalize all user-facing strings into resource files.
    2.  Use the user's Jira locale for number and date formatting.
    3.  Create a comprehensive `README.md`.
    4.  Build, package, and prepare for publishing to the Chrome Web Store.
