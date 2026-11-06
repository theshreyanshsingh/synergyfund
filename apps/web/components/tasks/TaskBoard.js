"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { PERMISSIONS, can as allowed } from "@synergifund/shared"
import { useSession } from "../shell/Providers"
import { Icon } from "../ui/Icon"
import { PageSpinner } from "../ui/Spinner"
import { api } from "../../lib/api"
import { useApi } from "../../lib/useApi"
import { usePhone } from "../../lib/usePhone"
import { DatePicker } from "./DatePicker"
import { TaskPanel } from "./TaskPanel"
import { Avatar, LabelOptions, PeopleOptions, PickerCell, PriorityOptions, PriorityPill, PropertyOptions, StatusOptions, StatusPill } from "./TaskPickers"
import { COLUMNS, COMPLETED_KEY, DUE_FILTERS, GROUPS, SORTS, STATUS_TONE, PRIORITY_TONE, TASK_PRIORITIES, TASK_STATUSES, dueLabel, filterTasks, groupTasks, isOverdue, sortTasks, todayKey } from "./taskFormat"

const SAVE_DELAY = 600
// Completing: the tick and strike-through first, then the row slides out, then it is in Completed.
const LEAVE_AFTER = 500
const MOVE_AFTER = 900
const ARRIVE_MS = 600
const TOAST_MS = 5000
const WIDTHS = { property: "150px", assignee: "160px", status: "128px", due: "108px", priority: "104px", labels: "170px", createdBy: "140px" }
const NO_FILTERS = { status: [], priority: [], assignee: [], property: [], label: [], due: [] }

function mailProblem(mail) {
  const status = typeof mail === "string" ? mail : mail?.status
  if (!status || status === "Sent" || status === "Skipped") return ""
  return `Saved, but the assignment email did not send. ${typeof mail === "object" ? mail?.error || "" : ""}`.trim()
}

// The Tasks table: a fixed set of columns everyone shares, in groups (Status by default, Completed folded at the
// bottom). Every cell edits in place; the name opens the task's panel. Hide, filter, sort and group are each person's
// own and kept for next time. With `propertyId`, one property's tasks (its Tasks tab).
export function TaskBoard({ propertyId = "" }) {
  const session = useSession()
  const user = session?.user
  const can = {
    user,
    edit: Boolean(user && (allowed(user, PERMISSIONS.tasksEdit) || allowed(user, PERMISSIONS.tasksManage))),
    assign: Boolean(user && allowed(user, PERMISSIONS.tasksAssign)),
    manage: Boolean(user && allowed(user, PERMISSIONS.tasksManage)),
  }
  const viewKey = propertyId ? "property" : "main"
  const list = useApi(propertyId ? `/tasks?propertyId=${propertyId}&view=property` : "/tasks")
  const peopleApi = useApi(can.assign ? "/tasks/assignees" : null)
  const propertiesApi = useApi(propertyId ? null : "/properties")
  const people = peopleApi.data?.items || []
  const properties = (propertiesApi.data?.items || []).map((item) => ({ id: item.id, address: item.address, city: item.city }))

  const [tasks, setTasks] = useState([])
  const [view, setView] = useState(null)
  const [query, setQuery] = useState("")
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState([])
  const [panel, setPanel] = useState({ id: "", comments: false })
  const [flags, setFlags] = useState({})
  const [toast, setToast] = useState(null)
  const [error, setError] = useState("")
  const [focusAdd, setFocusAdd] = useState("")
  const timers = useRef({})
  // Each task's last save, so an Undo waits for the save it undoes.
  const saving = useRef({})
  const toastTimer = useRef(null)
  const firstView = useRef(true)
  const phone = usePhone()

  useEffect(() => {
    if (!list.data) return
    setTasks(list.data.items)
    setView((current) => current || list.data.view)
  }, [list.data])

  // The page opens the way this person left it.
  useEffect(() => {
    if (!view) return undefined
    if (firstView.current) {
      firstView.current = false
      return undefined
    }
    const timer = setTimeout(() => api("/tasks/view", { method: "PATCH", body: { key: viewKey, view } }).catch(() => {}), SAVE_DELAY)
    return () => clearTimeout(timer)
  }, [view, viewKey])

  // A link to one task (the assignment email, a notification, Home) opens it; ?comments=1 opens it at Comments.
  const linked = useRef(false)
  useEffect(() => {
    if (linked.current || !list.data || propertyId) return
    linked.current = true
    const params = new URLSearchParams(window.location.search)
    const id = params.get("task")
    if (!id) return
    if (list.data.items.some((task) => task.id === id)) setPanel({ id, comments: params.get("comments") === "1" })
    else setError("That task is no longer on the list. It may have been deleted.")
  }, [list.data, propertyId])

  useEffect(() => () => {
    for (const pending of Object.values(timers.current)) pending.forEach(clearTimeout)
    clearTimeout(toastTimer.current)
  }, [])

  const knownLabels = useMemo(() => [...new Set(tasks.flatMap((task) => task.labels || []))], [tasks])

  if (!user) return null
  if (!list.data || !view) return list.error ? <p className="banner">{list.error}</p> : <PageSpinner />

  const setViewPart = (part) => setView((current) => ({ ...current, ...part }))
  const flag = (id, value) => setFlags((current) => {
    const next = { ...current }
    if (value) next[id] = value
    else delete next[id]
    return next
  })
  const arrive = (id) => {
    flag(id, "arriving")
    setTimeout(() => setFlags((current) => (current[id] === "arriving" ? (({ [id]: _, ...rest }) => rest)(current) : current)), ARRIVE_MS)
  }
  const showToast = (text, undo = null) => {
    clearTimeout(toastTimer.current)
    setToast({ text, undo, key: Date.now() })
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }
  // The server's copy, except while a completed row is still on its way out (it moves when the animation ends).
  const merge = (saved) => setTasks((current) => current.map((task) => {
    if (task.id !== saved.id) return task
    const moving = Boolean(timers.current[saved.id])
    const { history, ...fields } = saved
    return { ...task, ...fields, ...(moving ? { status: task.status, done: task.done } : {}), history }
  }))

  async function change(task, body) {
    setError("")
    const before = tasks.find((item) => item.id === task.id)
    const guess = { ...body }
    if ("assigneeId" in body) guess.assigneeName = people.find((person) => person.id === body.assigneeId)?.name || ""
    if ("propertyId" in body) guess.property = properties.find((property) => property.id === body.propertyId)?.address || ""
    setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, ...guess } : item)))
    try {
      const result = await api(`/tasks/${task.id}`, { method: "PATCH", body })
      merge(result.task)
      const problem = mailProblem(result.mail)
      if (problem) setError(problem)
    } catch (err) {
      setTasks((current) => current.map((item) => (item.id === task.id ? before : item)))
      setError(err.message)
    }
  }

  // Back to a status (Undo, or reopening): it moves back to that group.
  async function reopen(task, body) {
    setError("")
    try {
      const result = await api(`/tasks/${task.id}`, { method: "PATCH", body })
      merge(result.task)
      arrive(task.id)
    } catch (err) {
      setError(err.message)
    }
  }

  function complete(task) {
    if (timers.current[task.id]) return
    setError("")
    const previous = task.status
    flag(task.id, "checked")
    timers.current[task.id] = [
      setTimeout(() => flag(task.id, "leaving"), LEAVE_AFTER),
      setTimeout(() => {
        delete timers.current[task.id]
        flag(task.id, null)
        setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, status: "Completed", done: true } : item)))
        arrive(task.id)
      }, MOVE_AFTER),
    ]
    saving.current[task.id] = api(`/tasks/${task.id}`, { method: "PATCH", body: { status: "Completed" } })
      .then((result) => merge(result.task))
      .catch((err) => {
        ;(timers.current[task.id] || []).forEach(clearTimeout)
        delete timers.current[task.id]
        flag(task.id, null)
        setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, status: previous, done: false } : item)))
        setToast(null)
        setError(err.message)
      })
    showToast("Task completed", () => {
      setToast(null)
      const pending = timers.current[task.id]
      if (pending) {
        // Undone before it moved: it simply stays.
        pending.forEach(clearTimeout)
        delete timers.current[task.id]
        flag(task.id, null)
      }
      setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, status: previous, done: false } : item)))
      Promise.resolve(saving.current[task.id]).finally(() => reopen(task, { status: previous }))
    })
  }

  function toggle(task) {
    if (!can.edit) return
    if (task.status === "Completed") reopen(task, { done: false })
    else complete(task)
  }

  function setStatus(task, status) {
    if (status === task.status) return
    if (status === "Completed") complete(task)
    else if (task.status === "Completed") reopen(task, { status })
    else change(task, { status })
  }

  async function addTask(group, title) {
    setError("")
    const body = { title, ...group.add }
    if (propertyId) body.propertyId = propertyId
    if (!can.assign) delete body.assigneeId
    try {
      const result = await api("/tasks", { method: "POST", body })
      setTasks((current) => [...current, result.task])
      arrive(result.task.id)
      const problem = mailProblem(result.mail)
      if (problem) setError(problem)
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  async function duplicate(task) {
    setError("")
    try {
      const result = await api(`/tasks/${task.id}/duplicate`, { method: "POST" })
      setTasks((current) => [...current, result.task])
      arrive(result.task.id)
      setPanel({ id: result.task.id, comments: false })
      showToast("Task duplicated")
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(task) {
    if (!window.confirm("Delete this task?")) return
    setError("")
    try {
      await api(`/tasks/${task.id}`, { method: "DELETE" })
      setTasks((current) => current.filter((item) => item.id !== task.id))
      setPanel({ id: "", comments: false })
      showToast("Task deleted")
    } catch (err) {
      setError(err.message)
    }
  }

  async function bulk(action, value) {
    if (!selected.length) return
    if (action === "delete" && !window.confirm(`Delete ${selected.length === 1 ? "this task" : `these ${selected.length} tasks`}?`)) return
    setError("")
    try {
      const result = await api("/tasks/bulk", { method: "POST", body: { ids: selected, action, value } })
      if (action === "delete") setTasks((current) => current.filter((task) => !result.deleted.includes(task.id)))
      else result.tasks.forEach(merge)
      const count = action === "delete" ? result.deleted.length : result.tasks.length
      showToast(`${count} ${count === 1 ? "task" : "tasks"} ${action === "delete" ? "deleted" : "updated"}`)
      setSelected([])
      setSelecting(false)
      const problem = mailProblem(result.mail)
      if (problem) setError(problem)
    } catch (err) {
      setError(err.message)
    }
  }

  function newTask() {
    const first = groups.find((group) => group.add && group.key !== COMPLETED_KEY)
    if (!first) return
    if (view.collapsed.includes(first.key)) setViewPart({ collapsed: view.collapsed.filter((key) => key !== first.key) })
    setFocusAdd(`${first.key}:${Date.now()}`)
  }

  const today = list.data.today || todayKey()
  const groupBy = propertyId && view.groupBy === "property" ? "status" : view.groupBy
  const filters = { ...NO_FILTERS, ...view.filters, ...(propertyId ? { property: [] } : {}) }
  const shown = filterTasks(tasks, { query, me: view.me, meId: user.id, filters, today })
  const groups = groupTasks(shown, groupBy, { people, properties, fixedProperty: propertyId, today }).map((group) => ({ ...group, items: sortTasks(group.items, view.sort) }))
  const columns = COLUMNS.filter((column) => !view.hidden.includes(column.key) && !(propertyId && column.key === "property"))
  const template = [selecting ? "36px" : "", "44px", "minmax(220px, 1fr)", ...columns.map((column) => WIDTHS[column.key])].filter(Boolean).join(" ")
  // Narrower than this, the table scrolls sideways (the checkbox and name stay put).
  const minWidth = (selecting ? 36 : 0) + 44 + 220 + columns.reduce((total, column) => total + parseInt(WIDTHS[column.key], 10), 0) + 6
  const filterCount = Object.values(filters).reduce((total, values) => total + values.length, 0)
  const caughtUp = view.me && !shown.some((task) => task.status !== "Completed")
  const panelTask = tasks.find((task) => task.id === panel.id)
  const rowProps = { today, columns, can, people, properties, propertiesLoading: !propertiesApi.data && !propertyId, knownLabels, selecting, flags, onToggle: toggle, onSetStatus: setStatus, onChange: change, onOpen: (task, comments = false) => setPanel({ id: task.id, comments }) }

  return (
    <div className={selecting ? "tasks is-selecting" : "tasks"}>
      <div className="tasks-toolbar" role="toolbar" aria-label="Tasks">
        {can.manage && <button type="button" className="primary tasks-new" onClick={newTask}><Icon name="plus" size={14} /> New task</button>}
        <label className="tasks-search">
          <Icon name="search" size={15} />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search tasks" />
        </label>
        {/* On a phone: a row of its own that scrolls sideways, under the search and New task. */}
        <div className="tasks-tools">
          <button type="button" className={view.me ? "tasks-tool is-on" : "tasks-tool"} aria-pressed={view.me} onClick={() => setViewPart({ me: !view.me })} title="Only tasks assigned to me">
            <Icon name="person" size={16} /> Me
          </button>
          <ToolMenu icon="filter" label="Filter" on={filterCount > 0} count={filterCount} width={640}>
            {() => <FilterPanel tasks={tasks} today={today} shownCount={shown.length} filters={filters} fixedProperty={Boolean(propertyId)} onChange={(next) => setViewPart({ filters: next })} />}
          </ToolMenu>
          <ToolMenu icon="sort" label="Sort" on={Boolean(view.sort.key)} width={260}>
            {() => <SortPanel sort={view.sort} fixedProperty={Boolean(propertyId)} onChange={(sort) => setViewPart({ sort })} />}
          </ToolMenu>
          <ToolMenu icon="eyeOff" label="Hide" className="is-hide" quiet count={view.hidden.filter((key) => !(propertyId && key === "property")).length} width={260}>
            {() => <HidePanel hidden={view.hidden} fixedProperty={Boolean(propertyId)} onChange={(hidden) => setViewPart({ hidden })} />}
          </ToolMenu>
          <ToolMenu icon="group" label="Group by" on={groupBy !== "status"} width={220}>
            {(close) => <GroupPanel value={groupBy} fixedProperty={Boolean(propertyId)} onPick={(next) => { close(); setViewPart({ groupBy: next }) }} />}
          </ToolMenu>
          <button type="button" className={selecting ? "tasks-tool is-on" : "tasks-tool"} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelected([]) }}>
            <Icon name="check" size={16} /> Select
          </button>
        </div>
      </div>

      {error && <p className="banner tasks-banner">{error}</p>}
      {caughtUp && <p className="tasks-caught-up">You're all caught up</p>}

      <div className={phone ? "tasks-list" : "tasks-scroll"} style={phone ? undefined : { "--task-grid": template, "--task-min": `${minWidth}px` }}>
        {groups.map((group) => (
          <TaskGroup
            key={group.key}
            group={group}
            collapsed={view.collapsed.includes(group.key)}
            onFold={() => setViewPart({ collapsed: view.collapsed.includes(group.key) ? view.collapsed.filter((key) => key !== group.key) : [...view.collapsed, group.key] })}
            canAdd={can.manage && Boolean(group.add) && group.key !== COMPLETED_KEY}
            focusAdd={focusAdd.startsWith(`${group.key}:`) ? focusAdd : ""}
            onAdd={(title) => addTask(group, title)}
            selected={selected}
            onSelect={(id) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))}
            onSelectAll={(ids, on) => setSelected((current) => (on ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id))))}
            rowProps={rowProps}
            phone={phone}
          />
        ))}
      </div>

      {selecting && (
        <div className="tasks-bulk" role="toolbar" aria-label="Selected tasks">
          <strong>{selected.length} selected</strong>
          {can.edit && (
            <ToolMenu icon="layers" label={phone ? "Status" : "Change status"} disabled={!selected.length} width={200}>
              {(close) => <StatusOptions value="" onPick={(status) => { close(); bulk("status", status) }} />}
            </ToolMenu>
          )}
          {can.assign && (
            <ToolMenu icon="users" label={phone ? "Assignee" : "Change assignee"} disabled={!selected.length} width={300}>
              {(close) => <PeopleOptions people={people} value={null} onPick={(id) => { close(); bulk("assignee", id) }} />}
            </ToolMenu>
          )}
          {can.edit && (
            <ToolMenu icon="calendar" label={phone ? "Due date" : "Change due"} disabled={!selected.length} width={300}>
              {(close) => <DatePicker value="" today={today} onPick={(due) => { close(); bulk("due", due) }} />}
            </ToolMenu>
          )}
          {can.manage && <button type="button" className="tasks-tool is-danger" disabled={!selected.length} onClick={() => bulk("delete")}><Icon name="trash" size={15} /> Delete</button>}
          <button type="button" className="tasks-tool is-cancel" onClick={() => { setSelecting(false); setSelected([]) }}>Cancel</button>
        </div>
      )}

      {toast && (
        <div className="tasks-toast" role="status" key={toast.key}>
          <span>{toast.text}</span>
          {toast.undo && <button type="button" onClick={toast.undo} aria-label="Undo" title="Undo"><Icon name="undo" size={16} /></button>}
        </div>
      )}

      {panelTask && (
        <TaskPanel
          key={panelTask.id}
          task={panelTask}
          can={can}
          people={people}
          properties={properties}
          propertiesLoading={!propertiesApi.data && !propertyId}
          knownLabels={knownLabels}
          today={today}
          fixedProperty={Boolean(propertyId)}
          focusComments={panel.comments}
          onChange={change}
          onSetStatus={setStatus}
          onToggle={toggle}
          onDuplicate={duplicate}
          onDelete={remove}
          onCommentCount={(id, count) => setTasks((current) => (current.some((task) => task.id === id && task.commentCount !== count) ? current.map((task) => (task.id === id ? { ...task, commentCount: count } : task)) : current))}
          onClose={() => setPanel({ id: "", comments: false })}
        />
      )}
    </div>
  )
}

// A toolbar button with its panel underneath.
// `quiet`: its count is grey (Hide: hidden columns are a choice, not a filter on what shows).
function ToolMenu({ icon, label, on = false, quiet = false, count = 0, disabled = false, width, className = "", children }) {
  return (
    <PickerCell className={["tasks-tool", on ? "is-on" : "", className].filter(Boolean).join(" ")} disabled={disabled} label={label} width={width} pick={children}>
      <Icon name={icon} size={16} /> {label}{count > 0 && <em className={quiet ? "tasks-tool-count is-quiet" : "tasks-tool-count"}>{count}</em>}
    </PickerCell>
  )
}

function FilterPanel({ tasks, today, shownCount, filters, fixedProperty, onChange }) {
  const count = (test) => tasks.filter(test).length
  const toggle = (key, value) => {
    const list = filters[key] || []
    onChange({ ...filters, [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value] })
  }
  const people = [...new Map(tasks.filter((task) => task.assigneeId).map((task) => [task.assigneeId, task.assigneeName || "Someone"])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const places = [...new Map(tasks.filter((task) => task.propertyId).map((task) => [task.propertyId, task.property || "Property"])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const labels = [...new Set(tasks.flatMap((task) => task.labels || []))].sort()
  const total = Object.values(filters).reduce((sum, values) => sum + values.length, 0)
  return (
    <div className="tasks-filter">
      <div className="tasks-filter-head">
        <strong>Filters</strong>
        <span>{total ? `Showing ${shownCount} of ${tasks.length} tasks` : `Showing all of ${tasks.length} tasks`}</span>
        <button type="button" className="tool" disabled={!total} onClick={() => onChange({ status: [], priority: [], assignee: [], property: [], label: [], due: [] })}>Clear all</button>
      </div>
      <div className="tasks-filter-cols">
        <FilterColumn filters={filters} onToggle={toggle} title="Status" items={TASK_STATUSES.map((status) => ({ key: "status", value: status, label: status, tone: STATUS_TONE[status], count: count((task) => task.status === status) }))} />
        <FilterColumn filters={filters} onToggle={toggle} title="Priority" items={TASK_PRIORITIES.map((priority) => ({ key: "priority", value: priority, label: priority, tone: PRIORITY_TONE[priority], count: count((task) => task.priority === priority) }))} />
        <FilterColumn filters={filters} onToggle={toggle} title="Assigned to" items={[...people.map(([id, name]) => ({ key: "assignee", value: id, label: name, count: count((task) => task.assigneeId === id) })), { key: "assignee", value: "none", label: "Unassigned", count: count((task) => !task.assigneeId) }]} />
        {!fixedProperty && <FilterColumn filters={filters} onToggle={toggle} title="Property" items={[...places.map(([id, name]) => ({ key: "property", value: id, label: name, count: count((task) => task.propertyId === id) })), { key: "property", value: "none", label: "No property", count: count((task) => !task.propertyId) }]} />}
        <FilterColumn filters={filters} onToggle={toggle} title="Label" items={labels.map((label) => ({ key: "label", value: label, label, count: count((task) => (task.labels || []).includes(label)) }))} />
        <FilterColumn filters={filters} onToggle={toggle} title="Due" items={DUE_FILTERS.map((item) => ({ key: "due", value: item.key, label: item.label, count: filterTasks(tasks, { filters: { due: [item.key] }, today }).length }))} />
      </div>
    </div>
  )
}

// One column of filter chips: each with its color dot (Status, Priority) and how many tasks have it.
function FilterColumn({ title, items, filters, onToggle }) {
  return (
    <div className="tasks-filter-col">
      <p>{title}</p>
      {items.map((item) => {
        const on = (filters[item.key] || []).includes(item.value)
        return (
          <button key={item.value} type="button" className={on ? "tasks-filter-chip is-on" : "tasks-filter-chip"} aria-pressed={on} onClick={() => onToggle(item.key, item.value)}>
            {item.tone && <i className={`tasks-dot tone-${item.tone}`} />}
            <span>{item.label}</span>
            <em>{item.count || "–"}</em>
          </button>
        )
      })}
      {!items.length && <span className="tasks-filter-none">None yet</span>}
    </div>
  )
}

function SortPanel({ sort, fixedProperty, onChange }) {
  return (
    <div className="tasks-menu">
      <p className="tasks-menu-title">Sort by</p>
      {SORTS.filter((item) => !(fixedProperty && item.key === "property")).map((item) => (
        <button key={item.key} type="button" className={sort.key === item.key ? "tasks-menu-row is-on" : "tasks-menu-row"} aria-pressed={sort.key === item.key} onClick={() => onChange({ key: item.key, dir: sort.key === item.key ? sort.dir : "asc" })}>
          {item.label}{sort.key === item.key && <Icon name="tick" size={14} />}
        </button>
      ))}
      <div className="tasks-menu-dir">
        <button type="button" className={sort.dir !== "desc" ? "is-on" : ""} disabled={!sort.key} onClick={() => onChange({ ...sort, dir: "asc" })}>Ascending</button>
        <button type="button" className={sort.dir === "desc" ? "is-on" : ""} disabled={!sort.key} onClick={() => onChange({ ...sort, dir: "desc" })}>Descending</button>
      </div>
      {sort.key && <button type="button" className="tasks-menu-clear" onClick={() => onChange({ key: "", dir: "asc" })}>Clear sort</button>}
    </div>
  )
}

function HidePanel({ hidden, fixedProperty, onChange }) {
  return (
    <div className="tasks-menu">
      <p className="tasks-menu-title">Show columns</p>
      {COLUMNS.filter((column) => !(fixedProperty && column.key === "property")).map((column) => (
        <label key={column.key} className="tasks-menu-check">
          <input type="checkbox" checked={!hidden.includes(column.key)} onChange={() => onChange(hidden.includes(column.key) ? hidden.filter((key) => key !== column.key) : [...hidden, column.key])} />
          {column.label}
        </label>
      ))}
    </div>
  )
}

function GroupPanel({ value, fixedProperty, onPick }) {
  return (
    <div className="tasks-menu">
      <p className="tasks-menu-title">Group by</p>
      {GROUPS.filter((item) => !(fixedProperty && item.key === "property")).map((item) => (
        <button key={item.key} type="button" className={value === item.key ? "tasks-menu-row is-on" : "tasks-menu-row"} aria-pressed={value === item.key} onClick={() => onPick(item.key)}>
          {item.label}{value === item.key && <Icon name="tick" size={14} />}
        </button>
      ))}
    </div>
  )
}

function TaskGroup({ group, collapsed, onFold, canAdd, focusAdd, onAdd, selected, onSelect, onSelectAll, rowProps, phone = false }) {
  const { columns, selecting } = rowProps
  const ids = group.items.map((task) => task.id)
  const all = ids.length > 0 && ids.every((id) => selected.includes(id))
  return (
    <section className={[`tasks-group tone-${group.tone || "plain"}`, collapsed ? "is-collapsed" : ""].filter(Boolean).join(" ")} aria-label={group.name}>
      <div className="tasks-group-bar">
        <button type="button" className="tasks-group-head" aria-expanded={!collapsed} onClick={onFold}>
          <Icon name="chevron" size={14} />
          <span className="tasks-group-name">{group.name}</span>
          <em>{group.items.length}</em>
        </button>
        {phone && selecting && !collapsed && ids.length > 0 && (
          <button type="button" className="tasks-group-all" onClick={() => onSelectAll(ids, !all)}>{all ? "Clear" : "Select all"}</button>
        )}
      </div>
      {/* A phone: one card per task (tap to open it; the status and checkbox work in place). */}
      {!collapsed && phone && (
        <div className="tasks-cards" role="list" aria-label={`${group.name} tasks`}>
          {group.items.length ? group.items.map((task) => (
            <TaskCard key={task.id} task={task} selected={selected.includes(task.id)} onSelect={() => onSelect(task.id)} {...rowProps} />
          )) : <p className="tasks-empty" role="listitem">No tasks here</p>}
          {canAdd && <AddRow focus={focusAdd} onAdd={onAdd} card />}
        </div>
      )}
      {!collapsed && !phone && (
        <div className="tasks-table" role="table" aria-label={`${group.name} tasks`}>
          <div className="tasks-row is-head" role="row">
            {selecting && (
              <span className="tasks-cell is-select" role="columnheader">
                <input type="checkbox" className="tasks-select" checked={all} disabled={!ids.length} onChange={() => onSelectAll(ids, !all)} aria-label={`Select all in ${group.name}`} />
              </span>
            )}
            <span className="tasks-cell is-check" role="columnheader"><span className="sr-only">Done</span></span>
            <span className="tasks-cell is-title" role="columnheader">Task</span>
            {columns.map((column) => <span key={column.key} className={`tasks-cell is-${column.key}`} role="columnheader">{column.label}</span>)}
          </div>
          {group.items.length ? group.items.map((task) => (
            <TaskRow key={task.id} task={task} selected={selected.includes(task.id)} onSelect={() => onSelect(task.id)} {...rowProps} />
          )) : <div className="tasks-empty" role="row"><span role="cell">No tasks here</span></div>}
          {canAdd && <AddRow focus={focusAdd} onAdd={onAdd} selecting={selecting} />}
        </div>
      )}
    </section>
  )
}

// `card`: the phone's list, where it is the last card of the group.
function AddRow({ focus, onAdd, selecting, card = false }) {
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (focus) {
      ref.current?.focus()
      ref.current?.scrollIntoView({ block: "center", behavior: "smooth" })
    }
  }, [focus])
  const form = (
    <form onSubmit={async (event) => {
      event.preventDefault()
      const name = title.trim()
      if (!name || busy) return
      setBusy(true)
      if (await onAdd(name)) setTitle("")
      setBusy(false)
    }}>
      {/* Read-only while saving (not disabled), so it keeps focus for the next one. */}
      <input ref={ref} className="tasks-add-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="+ Add task" aria-label="Add a task" maxLength={300} readOnly={busy} enterKeyHint="done" />
    </form>
  )
  if (card) return <div className="task-card is-add" role="listitem">{form}</div>
  // A row of the table like the others (the form sits in its cell: a form can't be a table row).
  return (
    <div className="tasks-row is-add" role="row">
      {selecting && <span className="tasks-cell is-select" role="cell" />}
      <span className="tasks-cell is-check" role="cell" />
      <span className="tasks-add-cell" role="cell">{form}</span>
    </div>
  )
}

// One task on a phone: the checkbox, its name and what matters at a glance (property, due date, who), and its status,
// which changes in place. Tapping the card opens the task (in Select, it picks the card instead).
function TaskCard({ task, today, can, selecting, flags, selected, onSelect, onToggle, onSetStatus, onOpen }) {
  const state = flags[task.id]
  const done = task.status === "Completed"
  const ticked = done || state === "checked" || state === "leaving"
  const overdue = isOverdue(task, today) && !ticked
  const comments = task.commentCount ? `${task.commentCount} ${task.commentCount === 1 ? "comment" : "comments"}` : ""
  return (
    <div
      className={["task-card", ticked ? "is-ticked" : "", state === "leaving" ? "is-leaving" : "", state === "arriving" ? "is-arriving" : "", selected ? "is-selected" : ""].filter(Boolean).join(" ")}
      role="listitem"
      data-task-id={task.id}
    >
      {selecting && <input type="checkbox" className="tasks-select" checked={selected} onChange={onSelect} aria-label={`Select ${task.title}`} />}
      <button type="button" role="checkbox" aria-checked={ticked} className={ticked ? "task-check is-on" : "task-check"} disabled={!can.edit} onClick={() => onToggle(task)} aria-label={ticked ? `Reopen ${task.title}` : `Complete ${task.title}`}>
        {ticked && <Icon name="tick" size={13} />}
      </button>
      <button type="button" className="task-card-main" onClick={() => (selecting ? onSelect() : onOpen(task))} aria-label={selecting ? `Select ${task.title}` : undefined}>
        <span className="task-name">{task.title}</span>
        <span className="task-card-meta">
          {task.due && <span className={["task-due", overdue ? "is-overdue" : "", ticked ? "is-done" : ""].filter(Boolean).join(" ")}><Icon name="calendar" size={12} /> {dueLabel(task.due)}</span>}
          {task.property && <span className="task-card-place"><Icon name="building" size={12} /> {task.property}</span>}
          {task.priority === "High" && <PriorityPill priority="High" />}
        </span>
      </button>
      <div className="task-card-side">
        <PickerCell className="task-card-status" disabled={!can.edit} label={`Status of ${task.title}: ${ticked ? "Completed" : task.status}`} width={220} pick={(close) => <StatusOptions value={task.status} onPick={(status) => { close(); onSetStatus(task, status) }} />}>
          <StatusPill status={ticked ? "Completed" : task.status} />
        </PickerCell>
        <span className="task-card-who">
          {comments && (
            <button type="button" className="task-bubble has-count" onClick={() => onOpen(task, true)} aria-label={comments} title={comments}>
              <Icon name="comment" size={16} />
              <em>{task.commentCount}</em>
            </button>
          )}
          {task.assigneeName && <span title={task.assigneeName}><Avatar name={task.assigneeName} /></span>}
        </span>
      </div>
    </div>
  )
}

function TaskRow({ task, today, columns, can, people, properties, propertiesLoading, knownLabels, selecting, flags, selected, onSelect, onToggle, onSetStatus, onChange, onOpen }) {
  const state = flags[task.id]
  const done = task.status === "Completed"
  const ticked = done || state === "checked" || state === "leaving"
  const cell = (key, content) => <div key={key} className={`tasks-cell is-${key}`} role="cell">{content}</div>
  const cells = {
    property: () => cell("property", (
      <PickerCell className="tasks-edit" disabled={!can.edit} label={`Property for ${task.title}`} width={300} pick={(close) => (
        <PropertyOptions properties={properties} loading={propertiesLoading} value={task.propertyId} onPick={(id) => { close(); onChange(task, { propertyId: id }) }} />
      )}>
        {task.property ? <span className="task-chip" title={task.property}><Icon name="building" size={12} /> <span>{task.property}</span></span> : <span className="task-empty">—</span>}
      </PickerCell>
    )),
    assignee: () => cell("assignee", (
      <PickerCell className="tasks-edit" disabled={!can.assign} title={can.assign ? undefined : task.assigneeName || "Unassigned"} label={`Assignee for ${task.title}`} width={300} pick={(close) => (
        <PeopleOptions people={people} value={task.assigneeId} onPick={(id) => { close(); onChange(task, { assigneeId: id }) }} />
      )}>
        <span className="task-person"><Avatar name={task.assigneeName} />{task.assigneeName ? <span>{task.assigneeName}</span> : <span className="task-empty">Unassigned</span>}</span>
      </PickerCell>
    )),
    status: () => cell("status", (
      <PickerCell className="tasks-edit is-fill" disabled={!can.edit} label={`Status of ${task.title}: ${task.status}`} width={200} pick={(close) => <StatusOptions value={task.status} onPick={(status) => { close(); onSetStatus(task, status) }} />}>
        <StatusPill status={ticked ? "Completed" : task.status} />
      </PickerCell>
    )),
    due: () => cell("due", (
      <PickerCell className="tasks-edit" disabled={!can.edit} label={`Due date of ${task.title}`} width={300} pick={(close) => <DatePicker value={task.due} today={today} onPick={(due) => { close(); onChange(task, { due }) }} />}>
        {task.due ? <span className={["task-due", isOverdue(task, today) && !ticked ? "is-overdue" : "", ticked ? "is-done" : ""].filter(Boolean).join(" ")}>{dueLabel(task.due)}</span> : <span className="task-empty">—</span>}
      </PickerCell>
    )),
    priority: () => cell("priority", (
      <PickerCell className="tasks-edit" disabled={!can.edit} label={`Priority of ${task.title}: ${task.priority}`} width={180} pick={(close) => <PriorityOptions value={task.priority} onPick={(priority) => { close(); onChange(task, { priority }) }} />}>
        <PriorityPill priority={task.priority} />
      </PickerCell>
    )),
    labels: () => cell("labels", (
      <PickerCell className="tasks-edit" disabled={!can.edit} label={`Labels of ${task.title}`} width={300} pick={() => <LabelOptions value={task.labels} known={knownLabels} onChange={(labels) => onChange(task, { labels })} />}>
        {task.labels.length ? (
          <span className="task-labels">
            {task.labels.slice(0, 2).map((label) => <span key={label} className="task-label is-on">{label}</span>)}
            {task.labels.length > 2 && <span className="task-label-more">+{task.labels.length - 2}</span>}
          </span>
        ) : <span className="task-empty">—</span>}
      </PickerCell>
    )),
    createdBy: () => cell("createdBy", <span className="task-by">{task.createdByName || "—"}</span>),
  }
  return (
    <div
      className={["tasks-row", ticked ? "is-ticked" : "", state === "leaving" ? "is-leaving" : "", state === "arriving" ? "is-arriving" : "", selected ? "is-selected" : ""].filter(Boolean).join(" ")}
      role="row"
      data-task-id={task.id}
    >
      {selecting && (
        <div className="tasks-cell is-select" role="cell">
          <input type="checkbox" className="tasks-select" checked={selected} onChange={onSelect} aria-label={`Select ${task.title}`} />
        </div>
      )}
      <div className="tasks-cell is-check" role="cell">
        <button type="button" role="checkbox" aria-checked={ticked} className={ticked ? "task-check is-on" : "task-check"} disabled={!can.edit} onClick={() => onToggle(task)} aria-label={ticked ? `Reopen ${task.title}` : `Complete ${task.title}`}>
          {ticked && <Icon name="tick" size={13} />}
        </button>
      </div>
      <div className="tasks-cell is-title" role="cell">
        <button type="button" className="task-name" onClick={() => onOpen(task)} title={task.title}>{task.title}</button>
        <button type="button" className={task.commentCount ? "task-bubble has-count" : "task-bubble"} onClick={() => onOpen(task, true)} aria-label={task.commentCount ? `${task.commentCount} ${task.commentCount === 1 ? "comment" : "comments"}` : "Add a comment"} title={task.commentCount ? `${task.commentCount} ${task.commentCount === 1 ? "comment" : "comments"}` : "Add a comment"}>
          <Icon name={task.commentCount ? "comment" : "commentAdd"} size={17} />
          {task.commentCount > 0 && <em>{task.commentCount}</em>}
        </button>
      </div>
      {columns.map((column) => cells[column.key]())}
    </div>
  )
}
