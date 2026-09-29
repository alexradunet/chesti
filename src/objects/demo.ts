import { TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID, TASK_SCHEDULED_PROPERTY_ID, TASK_TYPE_ID, PAGE_TYPE_ID, EVENT_DATES_PROPERTY_ID, EVENT_TYPE_ID, REMINDER_DATE_PROPERTY_ID, REMINDER_TYPE_ID, JOURNAL_DATE_PROPERTY_ID, JOURNAL_TYPE_ID, PERSON_TYPE_ID, PERSON_RELATIONSHIP_PROPERTY_ID, PERSON_LAST_CONNECTED_PROPERTY_ID, PERSON_RECONNECT_EVERY_PROPERTY_ID } from './model.js';
import type { ObjectRuntime } from './runtime.js';
import { ViewService } from './views.js';

function addDays(date: Date, days: number): string {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function link(id: string, label: string): string { return `[${label}](/objects/${id})`; }

export function seedDemo(objects: ObjectRuntime): void {
  const views = new ViewService(objects);
  const today = new Date();
  const day = addDays(today, 0);
  const tomorrow = addDays(today, 1);
  const nextWeek = addDays(today, 7);

  const start = objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Start here · fixed domains', properties: {}, body: `# Welcome to Taskdesk

This fresh workspace has six fixed domains: Page, Task, Event, Reminder, Daily Page, and Person.

Connections are ordinary Markdown links. Try opening the linked task after you save your own edits.` });
  const task = objects.createObject({ typeId: TASK_TYPE_ID, title: 'Try a fixed-domain task', properties: { [TASK_DONE_PROPERTY_ID]: false, [TASK_SCHEDULED_PROPERTY_ID]: day, [TASK_DUE_PROPERTY_ID]: tomorrow }, body: `This task links back to ${link(start.id, start.title)}.` });
  objects.createObject({ typeId: EVENT_TYPE_ID, title: 'Reading-room open house', properties: { [EVENT_DATES_PROPERTY_ID]: { start: tomorrow, end: nextWeek } }, body: `All-day events use exclusive end dates and normal writing links such as ${link(task.id, task.title)}.` });
  objects.createObject({ typeId: REMINDER_TYPE_ID, title: 'Bring notebook', properties: { [REMINDER_DATE_PROPERTY_ID]: tomorrow }, body: 'A reminder is a dated calendar item only: no notifications or recurrence.' });
  objects.createObject({ typeId: JOURNAL_TYPE_ID, title: day, properties: { [JOURNAL_DATE_PROPERTY_ID]: day }, body: 'First daily page in this fresh fixed-domain workspace.' });
  objects.createObject({ typeId: PERSON_TYPE_ID, title: 'Ada Example', properties: { [PERSON_RELATIONSHIP_PROPERTY_ID]: 'Friend', [PERSON_LAST_CONNECTED_PROPERTY_ID]: day, [PERSON_RECONNECT_EVERY_PROPERTY_ID]: 2 }, body: 'People keep optional relationship details. Next reconnect is derived, not stored.' });

  const taskBoard = views.create({ model: 'built-in/demo', spec: {
    title: '01 · Tasks by done state',
    description: 'A bundled editable board over the fixed Task fields.',
    blocks: [{
      title: 'Tasks', component: 'board', editable: true,
      sources: [{ typeId: TASK_TYPE_ID, bindings: { group: TASK_DONE_PROPERTY_ID, due: TASK_DUE_PROPERTY_ID, scheduled: TASK_SCHEDULED_PROPERTY_ID }, orderBy: { propertyId: TASK_DUE_PROPERTY_ID, direction: 'ascending' } }],
      columns: [{ role: 'due', label: 'Due' }, { role: 'scheduled', label: 'Scheduled' }],
    }],
  } }, 'Built-in fixed-domain task board');
  views.publish(taskBoard.id, taskBoard.revision);
  const calendar = views.create({ model: 'built-in/demo', spec: {
    title: '02 · Fixed-domain calendar',
    description: 'Tasks, events, reminders, and daily pages use their fixed temporal fields.',
    blocks: [
      { title: 'Scheduled tasks', component: 'calendar', editable: true, sources: [{ typeId: TASK_TYPE_ID, bindings: { date: TASK_SCHEDULED_PROPERTY_ID }, where: [{ propertyId: TASK_SCHEDULED_PROPERTY_ID, operator: 'notEmpty' }] }] },
      { title: 'Events', component: 'calendar', sources: [{ typeId: EVENT_TYPE_ID, bindings: { date: EVENT_DATES_PROPERTY_ID }, where: [{ propertyId: EVENT_DATES_PROPERTY_ID, operator: 'notEmpty' }] }] },
      { title: 'Reminders', component: 'calendar', sources: [{ typeId: REMINDER_TYPE_ID, bindings: { date: REMINDER_DATE_PROPERTY_ID }, where: [{ propertyId: REMINDER_DATE_PROPERTY_ID, operator: 'notEmpty' }] }] },
      { title: 'Daily pages', component: 'calendar', sources: [{ typeId: JOURNAL_TYPE_ID, bindings: { date: JOURNAL_DATE_PROPERTY_ID } }] },
    ],
  } }, 'Built-in fixed-domain calendar');
  views.publish(calendar.id, calendar.revision);
}
