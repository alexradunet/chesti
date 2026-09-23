---
contract: lifeapps/v1
id: wiki
name: Wiki
description: Linked Markdown with optional structured identities.
types:
  page:
    version: 1
    storage:
      defaultFolder: Inbox
    fields: {}
    actions:
      create:
        operation: record.create
      edit:
        operation: record.update
        fields: [title, body]
collections:
  pages:
    type: page
views:
  default:
    collection: pages
    presentation: list
---
# Wiki

Ordinary notes do not need frontmatter. A managed wiki page gets an identity so
other apps can reference it by ID. This collection lists managed pages only;
the vault reader also exposes untyped notes and all other records' Markdown.

PARA category comes from folder location, not a second frontmatter field.
