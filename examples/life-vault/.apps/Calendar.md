---
contract: lifeapps/v1
id: calendar
name: Calendar
description: Local events, separate from dated tasks and journals.
types:
  event:
    version: 1
    storage:
      defaultFolder: Calendar
    fields:
      day:
        type: date
      when:
        type: time-range
      project:
        type: reference
        target: wiki.page
    rules:
      - kind: exactlyOne
        fields: [day, when]
    actions:
      create:
        operation: record.create
      edit:
        operation: record.update
        fields: [title, body, day, when, project]
collections:
  events:
    type: event
views:
  default:
    collection: events
    presentation: list
  timed:
    collection: events
    presentation: calendar
    mapping: {date: when, label: title}
  allDay:
    collection: events
    presentation: calendar
    mapping: {date: day, label: title}
---
# Calendar

An event has either a calendar day or a time range, never both.

Dated tasks and journals will be projected into the calendar without duplicate event files.
