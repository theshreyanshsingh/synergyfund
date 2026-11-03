"use client"

import { useEffect, useRef, useState } from "react"
import { Icon } from "../ui/Icon"
import { RowMenu } from "../ui/RowMenu"
import { api } from "../../lib/api"
import { DatePicker } from "./DatePicker"
import { TaskComments } from "./TaskComments"
import { Avatar, LabelOptions, PeopleOptions, PickerCell, PriorityOptions, PriorityPill, PropertyOptions, StatusOptions, StatusPill } from "./TaskPickers"
import { dueLabel, isOverdue } from "./taskFormat"

// "Oct 15"
function when(value) {
  const date = new Date(value)
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) })
}

// One task, from the side: its checkbox and name, the same fields as the table, Description, Comments and its log.
// Changes go through the board (`change`, `setStatus`), so the table follows at once.
export function TaskPanel({ task, today, can, people, properties, propertiesLoading, knownLabels, fixedProperty, focusComments, onChange, onSetStatus, onToggle, onDuplicate, onDelete, onCommentCount, onClose }) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes || "")
  const [history, setHistory] = useState(null)
  const [copied, setCopied] = useState(false)
  const notesRef = useRef(null)

  useEffect(() => setTitle(task.title), [task.id, task.title])
  useEffect(() => setNotes(task.notes || ""), [task.id])
  useEffect(() => {
    let alive = true
    setHistory(null)
    api(`/tasks/${task.id}`).then((result) => { if (alive) setHistory(result.task.history || []) }).catch(() => { if (alive) setHistory([]) })
    return () => { alive = false }
  }, [task.id])
  // After each change, the log as saved.
  useEffect(() => {
    if (task.history) setHistory(task.history)
  }, [task.history])

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape" && !document.querySelector(".popover")) onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  useEffect(() => {
    const element = notesRef.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.max(88, element.scrollHeight)}px`
  }, [notes])

  const done = task.status === "Completed"
  const saveTitle = () => {
    const next = title.replace(/\s+/g, " ").trim()
    if (!next) setTitle(task.title)
    else if (next !== task.title) onChange(task, { title: next })
  }
  const copyLink = async () => {
    const link = `${window.location.origin}/tasks?task=${task.id}`
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      window.prompt("Copy this link", link)
    }
  }
  const field = (label, control) => (
    <div className="task-field">
      <span className="task-field-label">{label}</span>
      <div className="task-field-control">{control}</div>
    </div>
  )

  return (
    <aside className="task-panel" role="dialog" aria-label={`Task: ${task.title}`}>
      <header className="task-panel-top">
        <button type="button" role="checkbox" aria-checked={done} className={done ? "task-check is-on" : "task-check"} disabled={!can.edit} onClick={() => onToggle(task)} aria-label={done ? "Reopen this task" : "Complete this task"}>
          {done && <Icon name="tick" size={14} />}
        </button>
        <input
          className={done ? "task-panel-title is-done" : "task-panel-title"}
          value={title}
          disabled={!can.edit}
          aria-label="Task name"
          maxLength={300}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={saveTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
            if (event.key === "Escape") { setTitle(task.title); event.currentTarget.blur() }
          }}
        />
        <RowMenu
          label="More for this task"
          className="keep-case"
          items={[
            { label: copied ? "Link copied" : "Copy task link", onClick: copyLink },
            can.manage && { label: "Duplicate", onClick: () => onDuplicate(task) },
            can.manage && { label: "Delete", danger: true, divider: true, onClick: () => onDelete(task) },
          ]}
        />
        <button type="button" className="task-panel-close" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
      </header>

      <div className="task-panel-body">
        <div className="task-fields">
          {!fixedProperty && field("Property", (
            <PickerCell className="task-field-button" disabled={!can.edit} label="Property" width={300} pick={(close) => (
              <PropertyOptions properties={properties} loading={propertiesLoading} value={task.propertyId} onPick={(id) => { close(); onChange(task, { propertyId: id }) }} />
            )}>
              {task.property ? <span className="task-chip"><Icon name="building" size={12} /> {task.property}</span> : <span className="task-empty">No property</span>}
            </PickerCell>
          ))}
          {field("Status", (
            <PickerCell className="task-field-button" disabled={!can.edit} label="Status" width={200} pick={(close) => <StatusOptions value={task.status} onPick={(status) => { close(); onSetStatus(task, status) }} />}>
              <StatusPill status={task.status} />
            </PickerCell>
          ))}
          {field("Priority", (
            <PickerCell className="task-field-button" disabled={!can.edit} label="Priority" width={180} pick={(close) => <PriorityOptions value={task.priority} onPick={(priority) => { close(); onChange(task, { priority }) }} />}>
              <PriorityPill priority={task.priority} />
            </PickerCell>
          ))}
          {field("Due", (
            <PickerCell className="task-field-button" disabled={!can.edit} label="Due date" width={300} pick={(close) => <DatePicker value={task.due} today={today} onPick={(due) => { close(); onChange(task, { due }) }} />}>
              {task.due ? <span className={["task-due", isOverdue(task, today) ? "is-overdue" : "", done ? "is-done" : ""].filter(Boolean).join(" ")}>{dueLabel(task.due)}</span> : <span className="task-empty">No date</span>}
            </PickerCell>
          ))}
          {field("Assigned to", (
            <PickerCell className="task-field-button" disabled={!can.assign} title={can.assign ? undefined : "You can't assign tasks"} label="Assigned to" width={300} pick={(close) => <PeopleOptions people={people} value={task.assigneeId} onPick={(id) => { close(); onChange(task, { assigneeId: id }) }} />}>
              <span className="task-person"><Avatar name={task.assigneeName} /> {task.assigneeName || <span className="task-empty">Unassigned</span>}</span>
            </PickerCell>
          ))}
          {field("Labels", (
            <PickerCell className="task-field-button" disabled={!can.edit} label="Labels" width={300} pick={() => <LabelOptions value={task.labels} known={knownLabels} onChange={(labels) => onChange(task, { labels })} />}>
              {task.labels.length ? <span className="task-labels">{task.labels.map((label) => <span key={label} className="task-label is-on">{label}</span>)}</span> : <span className="task-empty">No labels</span>}
            </PickerCell>
          ))}
          {task.createdByName && field("Assigned by", <span className="task-field-text">{task.createdByName}</span>)}
        </div>

        <section className="task-section">
          <h3>Description</h3>
          <textarea
            ref={notesRef}
            className="task-description"
            value={notes}
            disabled={!can.edit}
            placeholder={can.edit ? "Add details, steps or anything the assignee should know" : "No description"}
            maxLength={20000}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => { if (notes !== (task.notes || "")) onChange(task, { notes }) }}
          />
        </section>

        <TaskComments taskId={task.id} user={can.user} focus={focusComments} onCount={(count) => onCommentCount(task.id, count)} />

        <section className="task-section task-activity" aria-label="Activity">
          <h3>Activity</h3>
          {!history ? <p className="task-muted">Loading…</p> : !history.length ? <p className="task-muted">No changes recorded yet.</p> : (
            <ul>
              {[...history].reverse().map((entry, index) => (
                <li key={index}>{entry.text}{entry.byName ? ` by ${entry.byName}` : ""} · {when(entry.at)}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  )
}
