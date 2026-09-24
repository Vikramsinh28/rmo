---
name: Bug Report
description: Report a bug or unexpected behavior
title: "[Bug]: "
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to report a bug. Please fill out the sections below.

  - type: textarea
    id: description
    attributes:
      label: Describe the bug
      description: A clear and concise description of what went wrong.
      placeholder: What happened? What did you expect to happen?
    validations:
      required: true

  - type: textarea
    id: reproduction
    attributes:
      label: Steps to reproduce
      description: Minimal steps to reproduce the behavior.
      placeholder: |
        1. Go to '...'
        2. Click on '...'
        3. See error
    validations:
      required: true

  - type: textarea
    id: environment
    attributes:
      label: Environment
      description: Your local setup details.
      placeholder: |
        - OS: [e.g. macOS 15]
        - Node.js: [e.g. 22.x]
        - pnpm: [e.g. 10.x]
        - Browser (if relevant): [e.g. Chrome 131]
    validations:
      required: true

  - type: textarea
    id: logs
    attributes:
      label: Relevant logs or screenshots
      description: Paste error messages, stack traces, or attach screenshots.
    validations:
      required: false

  - type: checkboxes
    id: checklist
    attributes:
      label: Checklist
      options:
        - label: I searched existing issues and did not find a duplicate
          required: true
        - label: I am using the latest version from main
          required: false
