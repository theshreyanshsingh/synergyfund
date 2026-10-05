import { PERMISSION_CATALOG, PERMISSIONS, ROLE_PERMISSIONS } from "@synergifund/shared"

export function PermissionPicker({ role, selected, onChange, disabledIds = [] }) {
  const groups = []
  for (const item of PERMISSION_CATALOG) {
    const found = groups.find((group) => group.label === item.group)
    if (found) found.items.push(item)
    else groups.push({ label: item.group, items: [item] })
  }
  const defaults = new Set(ROLE_PERMISSIONS[role] || [])

  function toggle(id) {
    if (selected.includes(id)) {
      let next = selected.filter((item) => item !== id)
      if (id === PERMISSIONS.tasksAssign) next = next.filter((item) => item !== PERMISSIONS.tasksManage)
      onChange(next)
      return
    }
    const next = [...selected, id]
    if (id === PERMISSIONS.tasksManage && !next.includes(PERMISSIONS.tasksAssign)) next.push(PERMISSIONS.tasksAssign)
    onChange(next)
  }

  return (
    <div className="access-list">
      {groups.map((group) => (
        <section key={group.label}>
          <h3>{group.label}</h3>
          {group.items.map((item) => {
            const on = selected.includes(item.id)
            const locked = disabledIds.includes(item.id)
            return (
              <button key={item.id} type="button" className={on ? "access-row is-on" : "access-row"} onClick={() => { if (!locked) toggle(item.id) }} aria-pressed={on} disabled={locked}>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}{locked ? " · Only a super admin can grant this" : ""}{item.id === PERMISSIONS.tasksAssign && selected.includes(PERMISSIONS.tasksManage) ? " · Required to create and delete tasks" : ""}{on !== defaults.has(item.id) ? " · Changed from the role" : ""}</small>
                </span>
                <i />
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}
