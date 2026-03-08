# EMMA - ElectroMagnetic Mission Analysis

Is a version of a full-stack application for building heatmaps on top of a map, based on a calculation done in a different server.

This project is developed using **AI-assisted engineering (Cursor)** with human architectural oversight.

---

## Table of Contents

- [Repository Structure](#repository-structure)
- [Tech Stack](#tech-stack)
- [Development Philosophy](#development-philosophy)
- [AI Task Specification](#ai-task-specification)
- [Development Workflow](#development-workflow)
- [Project Phases](#project-phases)
- [Local Development](#local-development)
- [Linting & Code Quality](#linting--code-quality)
- [Contribution Rules](#contribution-rules)

---

## Repository Structure

---
```
repo
├ frontend      # React application
├ backend       # ASP.NET (.NET 8) API
├ infra         # Local development infrastructure (docker-compose)
├ contracts     # Shared schemas between frontend and backend
├ agents.md     # Rules for AI agents working in this repository
└ README.md
```
---

## Tech Stack

### Frontend
- React
- TypeScript
- Leaflet (map rendering)
- pnpm (package manager)
- ESLint (linting)

### Backend
- ASP.NET (.NET 8)
- C#

### Infrastructure
- docker-compose
- PostgreSQL *(future phase)*
- RabbitMQ *(future phase)*

---

## AI Task Specification

All development tasks **must follow the structure below** before AI implementation:

### 1. Problem Description

Explain **what needs to be built and why**.

Example:
```
Implement POST /calculate endpoint that receives ScenarioDraft
and returns a dummy calculation result.
```
---

### 2. Supporting Information

Provide necessary project context.

Examples:
```
- Backend: ASP.NET (.NET 8)
- Frontend: React + TypeScript
- Shared schema located in `/contracts`
- Follow REST conventions
```
---

### 3. Constraints

Define strict limits for the AI.

Examples:
```
- Do not introduce new dependencies
- Do not modify unrelated folders
- Do not implement future phases
- Keep implementation minimal
```
---

### 4. Steps to Complete

Break the work into clear implementation steps.

Example:

```

1. Create POST /calculate endpoint
2. Accept ScenarioDraft DTO
3. Validate input
4. Return dummy result
5. Add integration tests

```

---

### 5. Acceptance Criteria

Define when the task is considered complete.

Examples:
```
- Endpoint returns HTTP 200
- Response contains `calculationResult`
- Backend builds successfully
- Tests pass
```
---

### 6. Allowed Files

Limit which files the AI may modify.

Example:

```

/backend/controllers/*
/backend/tests/*

```

---

## Development Workflow

1. Create GitHub Issue using the AI task specification template  
2. Run AI agent in **Plan Mode**  
3. Review and approve the plan  
4. AI implements the feature  
5. AI runs build/tests  
6. Engineer reviews generated changes  
7. Create Pull Request  
8. Merge after approval  

### Workflow Rules

- One feature per PR
- Do not refactor unrelated code
- Prefer simple solutions
- Avoid unnecessary dependencies

---

## Project Phases

### Phase 1 — Initial Platform

- React UI
- Map entities
- ScenarioDraft creation
- Backend dummy calculation

### Phase 2 — Persistence

- Scenario database
- Large matrix storage

### Phase 3 — Computation Pipeline

- MATLAB integration
- Calculation pipeline

### Phase 4 — Production Infrastructure

- Containerized deployment
- AWS infrastructure
- Public API exposure

---

## Local Development

### Backend

```

cd backend
dotnet run

```

### Frontend

```

cd frontend
pnpm install
pnpm dev

```

### Infrastructure (future)

```

docker compose up -d

```

---

## Linting & Code Quality

### Frontend

```

pnpm lint

```

### Backend

```

dotnet build
dotnet test

```

---

## Contribution Rules

Before submitting code:

- Follow **agents.md**
- Use the **AI task specification format**
- Review **all AI-generated code**
- Ensure **build and tests pass**

### Merge Policy

- No direct commits to `main`
- All changes go through Pull Requests
- At least **one reviewer required**
```
