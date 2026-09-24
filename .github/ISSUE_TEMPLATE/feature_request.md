---
name: Feature Request
description: Suggest a new feature or improvement
title: "[Feature]: "
labels: ["enhancement"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for suggesting an improvement! Please describe the feature below.

  - type: textarea
    id: problem
    attributes:
      label: Problem or use case
      description: What problem does this solve? Who benefits?
      placeholder: I'm trying to... but currently...
    validations:
      required: true

  - type: textarea
    id: solution
    attributes:
      label: Proposed solution
      description: Describe the feature or change you'd like to see.
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
      description: Any alternative approaches you've thought about?
    validations:
      required: false

  - type: checkboxes
    id: checklist
    attributes:
      label: Checklist
      options:
        - label: I searched existing issues and did not find a duplicate
          required: true
        - label: I am willing to submit a PR for this feature
          required: false
