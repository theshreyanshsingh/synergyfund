"use client"

import { useEffect, useState } from "react"
import { PERMISSIONS, TASK_LABELS, can } from "@synergifund/shared"
import { FormSheet } from "../../../components/ui/FormSheet"
import { StatusPill } from "../../../components/ui/StatusPill"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { useApi } from "../../../lib/useApi"

export default function TasksPage() {
  const session = useSession()
  const list = useApi("/tasks")
  const [editing, setEditing] = useState(null)
  const [labels, setLabels] = useState([])
  const [draft, setDraft] = useState("")
  const [assigneeId, setAssigneeId] = useState("")
  const [people, setPeople] = useState([])
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState(false)
  const canEdit = session?.user && can(session.user, PERMISSIONS.tasksEdit)
  const canAssign = session?.user && can(session.user, PERMISSIONS.tasksAssign)
  const canManage = session?.user && can(session.user, PERMISSIONS.tasksManage)
  const items = list.data?.items || []
  const known = items.flatMap((item) => item.labels || [])
  const suggestions = [...new Set([...TASK_LABELS, ...known])]

  useEffect(() => {
    if (!canAssign) return undefined
    let active = true
    api("/tasks/assignees")
      .then((data) => { if (active) setPeople(data.items || []) })
      .catch(() => { if (active) setPeople([]) })
    return () => { active = false }
  }, [canAssign])

  function startCreate() {
    setError("")
    setEditing({ id: "" })
    setLabels([])
    setDraft("")
    setAssigneeId("")
  }

  function startEdit(row) {
    setError("")
    setEditing(row)
    setLabels(row.labels || [])
    setDraft("")
    setAssigneeId(row.assigneeId || "")
  }

  function addLabel(value) {
    const label = value.trim().replace(/\s+/g, " ")
    if (!label) return
    setLabels((current) => current.some((item) => item.toLowerCase() === label.toLowerCase()) ? current : [...current, label].slice(0, 8))
    setDraft("")
  }

  async function save(event) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget))
    const nextLabels = draft.trim() ? [...labels, draft.trim()] : labels
    const canChange = !editing?.id || canEdit || canManage
    const body = {}
    if (canChange) {
      body.title = form.title
      body.due = form.due || ""
      body.priority = form.priority
      body.notes = form.notes || ""
      body.labels = nextLabels
    }
    if (canAssign) body.assigneeId = assigneeId
    setPending(true)
    setError("")
    try {
      const saved = editing?.id
        ? await api(`/tasks/${editing.id}`, { method: "PATCH", body })
        : await api("/tasks", { method: "POST", body })
      setNotice(mailNotice(saved.mail))
      setEditing(null)
      list.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  async function toggle(row) {
    await api(`/tasks/${row.id}`, { method: "PATCH", body: { done: !row.done } })
    list.reload()
  }

  async function remove(row) {
    if (!window.confirm(`Delete “${row.title}”?`)) return
    setError("")
    try {
      await api(`/tasks/${row.id}`, { method: "DELETE" })
      if (editing?.id === row.id) setEditing(null)
      list.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      {notice && <div className="banner">{notice}</div>}
      <WorkspacePage
        views={false}
        loading={!list.data && !list.error}
        title="To-do list"
        action={canManage ? { label: "Add task", onClick: startCreate } : null}
        columns={[
          { key: "title", label: "Name", avatar: (row) => row.title, render: (row) => <span className="person-copy"><strong>{row.title}</strong><small>{row.notes || "No note"}</small></span> },
          { key: "assignee", label: "Assignee", render: (row) => row.assigneeName ? <span className="person-copy"><strong>{row.assigneeName}</strong>{row.assigneeEmail ? <small>{row.assigneeEmail}</small> : null}</span> : "Unassigned" },
          { key: "labels", label: "Labels", render: (row) => row.labels?.length ? <span className="label-row">{row.labels.map((label) => <StatusPill key={label}>{label}</StatusPill>)}</span> : "No label" },
          { key: "due", label: "Due", render: (row) => row.due || "No date" },
          { key: "priority", label: "Priority", render: (row) => <StatusPill>{row.priority}</StatusPill> },
          { key: "done", label: "Status", render: (row) => <StatusPill>{row.done ? "Complete" : "Open"}</StatusPill> },
          { key: "actions", label: "", pin: "right", render: (row) => (canEdit || canManage) ? <span className="row-actions"><button type="button" onClick={(event) => { event.stopPropagation(); toggle(row) }}>{row.done ? "Reopen" : "Mark done"}</button>{canManage && <button type="button" className="danger" onClick={(event) => { event.stopPropagation(); remove(row) }}>Delete</button>}</span> : null },
        ]}
        rows={items}
        important={(row) => !row.done && (row.priority === "High" || row.labels?.includes("Verify"))}
        onRow={(canEdit || canManage || canAssign) ? startEdit : undefined}
        empty="No tasks yet. Add one and label it, such as EMD, Mortgage payment, or Draw."
      />
      {editing && (
        <FormSheet eyebrow="To-do list" title={editing.id ? "Edit task" : "Add a task"} hint="Labels group the work. Presets cover EMD, mortgage payments, and draws." error={error} pending={pending} onClose={() => setEditing(null)} onSubmit={save} submitLabel={editing.id ? "Save task" : "Add task"}>
          <div className="form-grid">
            <label className="field wide"><span>What needs to happen?</span><input name="title" required defaultValue={editing.title || ""} disabled={Boolean(editing.id) && !(canEdit || canManage)} /></label>
            <label className="field"><span>Due</span><input name="due" type="date" defaultValue={editing.due || ""} disabled={Boolean(editing.id) && !(canEdit || canManage)} /></label>
            <label className="field"><span>Priority</span>
              <select name="priority" defaultValue={editing.priority || "Medium"} disabled={Boolean(editing.id) && !(canEdit || canManage)}><option>High</option><option>Medium</option><option>Low</option></select>
            </label>
            <div className="field wide">
              <span>Labels</span>
              <div className="label-editor">
                {labels.map((label) => (
                  <button key={label} type="button" className="label-chip" disabled={Boolean(editing.id) && !(canEdit || canManage)} onClick={() => setLabels((current) => current.filter((item) => item !== label))}>{label} ×</button>
                ))}
                <input
                  value={draft}
                  placeholder="Add a label"
                  disabled={Boolean(editing.id) && !(canEdit || canManage)}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      addLabel(draft)
                    }
                  }}
                />
              </div>
              <div className="label-suggestions">
                {(Boolean(editing.id) && !(canEdit || canManage) ? [] : suggestions.filter((label) => !labels.some((item) => item.toLowerCase() === label.toLowerCase()))).map((label) => (
                  <button key={label} type="button" onClick={() => addLabel(label)}>{label}</button>
                ))}
              </div>
            </div>
            {canAssign ? (
              <div className="field wide">
                <span>Assignee</span>
                <div className="assign-list task-people">
                  <label>
                    <input type="radio" name="assigneeChoice" checked={assigneeId === ""} onChange={() => setAssigneeId("")} />
                    Unassigned
                  </label>
                  {people.map((person) => (
                    <label key={person.id}>
                      <input type="radio" name="assigneeChoice" checked={assigneeId === person.id} onChange={() => setAssigneeId(person.id)} />
                      <span>{person.name}<small>{person.email}</small></span>
                    </label>
                  ))}
                </div>
                <p className="muted">The assignee receives an email.</p>
              </div>
            ) : (
              <p className="field wide muted">{editing.assigneeName ? `Assigned to ${editing.assigneeName}` : "Unassigned"}</p>
            )}
            <label className="field wide"><span>Note</span><input name="notes" defaultValue={editing.notes || ""} disabled={Boolean(editing.id) && !(canEdit || canManage)} /></label>
            {editing.id && canManage && <button type="button" className="danger" onClick={() => remove(editing)}>Delete task</button>}
          </div>
        </FormSheet>
      )}
    </>
  )
}

function mailNotice(mail) {
  const status = typeof mail === "string" ? mail : mail?.status
  const error = typeof mail === "string" ? "" : mail?.error
  if (status === "Sent") return "Assignment email sent."
  if (!status || status === "Skipped") return ""
  return `Task saved, but the assignment email did not send. ${error || ""}`.trim()
}
