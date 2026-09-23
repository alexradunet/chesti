---
contract: lifeapps/v1
id: journal
name: Daily journal
description: Free-form Markdown, one entry per local calendar day.
types:
  entry:
    version: 1
    storage:
      defaultFolder: Journal
    fields:
      date:
        type: date
        required: true
      project:
        type: reference
        target: wiki.page
    uniqueBy:
      - [date]
    actions:
      create:
        operation: record.create
      edit:
        operation: record.update
        fields: [title, body, date, project]
collections:
  entries:
    type: entry
    orderBy:
      - {field: date, direction: descending}
views:
  default:
    collection: entries
    presentation: list
  days:
    collection: entries
    presentation: calendar
    mapping: {date: date, label: title}
---
# Daily journal

Write in your own words. No headings or template sections are required.

This type represents one journal. Additional journals can declare their own type,
or explicitly migrate to a composite uniqueness key.
