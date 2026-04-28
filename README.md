# Spec-Driven Autonomous Coding System

SpecDrive AutoBuild is a spec-driven autonomous coding system designed for long-running, auditable software delivery with AI agents.

Languages: English | [中文](README.zh-CN.md) | [日本語](README.ja.md)

---

## Overview

SpecDrive AutoBuild is a long-running autonomous coding system for software teams. It uses structured specs to manage product goals and acceptance criteria, skills to encode reusable engineering workflows, subagents to isolate context and execute focused tasks, Codex Runner to modify code and run verification, and a Kanban state machine to manage workflow, review, recovery, and delivery.

In one sentence:

> AI should not just write code; it should deliver code through a controlled, recoverable, and auditable engineering workflow.

## Core Components

```text
Spec Protocol
+ Skill System
+ Subagent Runtime
+ Context Broker
+ Codex Runner
+ Kanban State Machine
```

## Key Capabilities

* Generate structured Feature Specs from natural language requirements.
* Decompose PR, RP, PRD, and EARS-style requirements into traceable Feature Specs.
* Produce technical plans, task graphs, acceptance criteria, and risk rules from specs.
* Split large work into isolated, bounded Subagent Runs.
* Provide each subagent with only the minimum context needed for the task.
* Use Codex Runner for coding, testing, fixing, and PR generation.
* Detect whether a task is done, failed, blocked, or needs human review.
* Support long-running execution, retries, resume, recovery, and delivery audit trails.

## Current Status

This repository is currently in the product design stage. The primary artifact is the PRD:

* [docs/README.md](docs/README.md)
* [docs/en/PRD.md](docs/en/PRD.md)

## MVP Scope

The MVP is planned to include:

* Spec Protocol and project creation.
* Skill registration, execution, and versioning.
* Subagent Runtime and Agent Run Contract.
* Context Broker and Evidence Pack.
* Codex Runner integration.
* Kanban state machine, status checks, and failure recovery.
* Review Center, PR generation, and delivery reports.

## Roadmap

The project will evolve through the following milestones:

### M1: Single-Project Autonomous Development

Build a complete autonomous delivery loop for one software project. The system should be able to initialize a project, maintain specs, select work, generate implementation tasks, run Codex CLI, collect evidence, recover from failures, and produce delivery artifacts such as review records, PRs, and reports.

### M2: Multi-CLI Runtime Support

Introduce a runner abstraction so the system can integrate with more coding CLIs beyond the initial Codex Runner. The runtime should normalize command execution, sandbox policies, context injection, evidence collection, error handling, and result reporting across supported CLI providers.

### M3: Stronger Development Process

Improve the engineering lifecycle around autonomous work. This includes richer test planning, layered verification, quality gates, release evidence, deployment preparation, environment checks, deployment execution, rollback guidance, and clearer human approval points.

### M4: Multi-Project Support

Extend the system from one autonomous project to a project portfolio. The platform should support project registration, isolated project memory, per-project specs and boards, shared skill governance, cross-project scheduling, portfolio-level visibility, and safe coordination of multiple active delivery streams.
