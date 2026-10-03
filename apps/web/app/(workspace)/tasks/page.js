"use client"

import { useState } from "react"
import { can } from "@synergifund/shared"
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
  const writable = session?.user && can(session.user, "tasks.write")
  const items = list.data?.items || []
  const known = [...new Set(items.flatMap((item) => item.labels || []))]
  const suggestions = [...new Set(["Verify", ...known])]

  function startCreate() {
    setEditing({ id: "" })
    setLabels([])
    setDraft("")
  }

  function startEdit(row) {
    setEditing(row)
    setLabels(row.labels || [])
    setDraft("")
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
    const body = { ...form, labels: draft.trim() ? [...labels, draft.trim()] : labels }
    if (editing?.id) await api(`/tasks/${editing.id}`, { method: "PATCH", body })
    else await api("/tasks", { method: "POST", body })
    setEditing(null)
    list.reload()
  }

  async function toggle(row) {
    await api(`/tasks/${row.id}`, { method: "PATCH", body: { done: !row.done } })
    list.reload()
  }

  return (
    <>
      <WorkspacePage
        views={false}
        title="To-do list"
        action={writable ? { label: "Add task", onClick: startCreate } : null}
        columns={[
          { key: "title", label: "Name", avatar: (row) => row.title, render: (row) => <span className="person-copy"><strong>{row.title}</strong><small>{row.notes || row.owner || "Unassigned"}</small></span> },
          { key: "labels", label: "Labels", render: (row) => row.labels?.length ? <span className="label-row">{row.labels.map((label) => <StatusPill key={label}>{label}</StatusPill>)}</span> : "No label" },
          { key: "due", label: "Due", render: (row) => row.due || "No date" },
          { key: "priority", label: "Priority", render: (row) => <StatusPill>{row.priority}</StatusPill> },
          { key: "done", label: "Status", render: (row) => <StatusPill>{row.done ? "Complete" : "Open"}</StatusPill> },
          { key: "actions", label: "", pin: "right", render: (row) => writable ? <span className="row-actions"><button type="button" onClick={(event) => { event.stopPropagation(); toggle(row) }}>{row.done ? "Reopen" : "Mark done"}</button></span> : null },
        ]}
        rows={items}
        important={(row) => !row.done && (row.priority === "High" || row.labels?.includes("Verify"))}
        onRow={writable ? startEdit : undefined}
        empty="No tasks yet. Add one and give it a label, such as Verify."
      />
      {editing && (
        <FormSheet eyebrow="To-do list" title={editing.id ? "Edit task" : "Add a task"} hint="A label is how you group work. Verify lives here, not on a separate list." onClose={() => setEditing(null)} onSubmit={save} submitLabel={editing.id ? "Save task" : "Add task"}>
          <div className="form-grid">
            <label className="field wide"><span>What needs to happen?</span><input name="title" required defaultValue={editing.title || ""} /></label>
            <label className="field"><span>Due</span><input name="due" type="date" defaultValue={editing.due || ""} /></label>
            <label className="field"><span>Priority</span>
              <select name="priority" defaultValue={editing.priority || "Medium"}><option>High</option><option>Medium</option><option>Low</option></select>
            </label>
            <div className="field wide">
              <span>Labels</span>
              <div className="label-editor">
                {labels.map((label) => (
                  <button key={label} type="button" className="label-chip" onClick={() => setLabels((current) => current.filter((item) => item !== label))}>{label} ×</button>
                ))}
                <input
                  value={draft}
                  placeholder="Add a label"
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
                {suggestions.filter((label) => !labels.some((item) => item.toLowerCase() === label.toLowerCase())).map((label) => (
                  <button key={label} type="button" onClick={() => addLabel(label)}>{label}</button>
                ))}
              </div>
            </div>
            <label className="field wide"><span>Note</span><input name="notes" defaultValue={editing.notes || ""} /></label>
          </div>
        </FormSheet>
      )}
    </>
  )
}
