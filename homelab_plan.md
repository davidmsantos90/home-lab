# Home Lab

This repository contains the complete Infrastructure as Code (IaC) configuration for my self-hosted homelab.

The goal is to keep every service self-contained, reproducible and easy to migrate to new hardware in the future.

---

# Repository Structure

The repository follows a **service-oriented** structure.

Each top-level directory represents a single service.

Example:

```
home-lab/
├── compose.yaml
├── README.md
├── lab.sh
├── sync-env.sh
│
├── immich/
├── jellyfin/
├── nginx-proxy-manager/
├── pihole/
├── plex/
├── portainer/
├── deluge/
└── wg-easy/
```

Each service is responsible for its own configuration and documentation.

---

# Service Layout

Every service should follow the same basic structure.

Minimum:

```
service-name/
├── compose.yaml
├── .env
├── .env.example
└── README.md
```

As a service grows in complexity, additional documentation can be added.

Example:

```
service-name/
├── compose.yaml
├── .env
├── .env.example
├── README.md
│
└── docs/
    ├── DESIGN.md
    ├── TESTING.md
    ├── TROUBLESHOOTING.md
    ├── SECURITY.md
    └── RFC-001-*.md
```

The `docs` directory is optional and should only be introduced when the service requires more detailed documentation.

---

# Documentation Guidelines

Each document has a specific purpose.

## README.md

High-level overview of the service.

Should include:

- Purpose
- Dependencies
- Environment variables
- Startup instructions
- Useful links

---

## DESIGN.md

Describes the architecture.

Typical contents:

- Network topology
- Docker networking
- Volumes
- Design decisions
- Future improvements

---

## TESTING.md

Contains validation procedures.

Examples:

- Installation tests
- Connectivity tests
- Upgrade verification
- Disaster recovery validation

---

## TROUBLESHOOTING.md

Known issues and solutions.

Should include:

- Symptoms
- Root cause
- Resolution
- References

---

## SECURITY.md

Documents security considerations.

Examples:

- Exposed ports
- Firewall rules
- Authentication
- Reverse proxy configuration
- Secrets management

---

## RFC-XXX.md

RFC (Request For Comments) documents describe architectural proposals before implementation.

RFCs should contain:

- Background
- Problem Statement
- Goals
- Non-goals
- Proposed Architecture
- Alternative Solutions
- Testing Plan
- Acceptance Criteria

RFCs should explain **why** a decision was made, not only **how** it was implemented.

---

# Design Principles

The repository follows these principles:

- One directory per service
- Self-contained services
- Docker-first
- Infrastructure as Code
- Easy migration
- Reproducible deployments
- Minimal manual configuration
- Documentation close to the implementation

---

# Documentation Philosophy

Documentation should live as close as possible to the code it describes.

For this reason:

- Service documentation belongs inside the service directory.
- Avoid global documentation whenever possible.
- Keep READMEs concise.
- Move advanced topics into the `docs` folder.

---

# Future Direction

The homelab is expected to evolve from a Raspberry Pi deployment towards a dedicated Proxmox server.

Documentation should therefore remain hardware-independent whenever possible.

Implementation details should focus on services rather than the underlying host.

---

# Contributing (Copilot Guidelines)

When modifying this repository:

- Preserve the existing directory structure.
- Prefer incremental improvements.
- Do not introduce unnecessary complexity.
- Keep documentation close to each service.
- Prefer Docker-native solutions.
- Consider future migration to Proxmox.
- Document architectural decisions before implementation when they significantly affect the infrastructure.