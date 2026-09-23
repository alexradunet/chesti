---
contract: lifeapps/v1
id: tasks
name: Tasks
description: Capture work without requiring a date or a project.
types:
  task:
    version: 1
    storage:
      defaultFolder: Inbox/Tasks
    fields:
      status:
        type: enum
        values: [open, active, done]
        required: true
        default: open
      due:
        type: date
      scheduled:
        type: time-range
      project:
        type: reference
        target: wiki.page
    actions:
      create:
        operation: record.create
      edit:
        operation: record.update
        fields: [title, body, due, scheduled, project]
      start:
        operation: record.update
        when: {field: status, equals: open}
        set: {status: active}
      complete:
        operation: record.update
        when: {field: status, in: [open, active]}
        set: {status: done}
      reopen:
        operation: record.update
        when: {field: status, equals: done}
        set: {status: open}
collections:
  unfinished:
    type: task
    where: {field: status, in: [open, active]}
    orderBy:
      - {field: due, direction: ascending, missing: last}
views:
  default:
    collection: unfinished
    presentation: list
  deadlines:
    collection: unfinished
    presentation: calendar
    mapping: {date: due, label: title}
  scheduled:
    collection: unfinished
    presentation: calendar
    mapping: {date: scheduled, label: title}
---
# Tasks

A deadline is not a work session. Unscheduled tasks remain useful.

This definition is a validation candidate, not an installed app.
