import { PERMISSION_CATALOG, ROLE_PERMISSIONS } from "@synergifund/shared"

export function PermissionPicker({ role, selected, onChange }) {
  const groups = []
  for (const item of PERMISSION_CATALOG) {
    const found = groups.find((group) => group.label === item.group)
    if (found) found.items.push(item)
    else groups.push({ label: item.group, items: [item] })
  }
  const defaults = new Set(ROLE_PERMISSIONS[role] || [])

  function toggle(id) {
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
  }

  return (
    <div className="access-list">
      {groups.map((group) => (
        <section key={group.label}>
          <h3>{group.label}</h3>
          {group.items.map((item) => {
            const on = selected.includes(item.id)
            return (
              <button key={item.id} type="button" className={on ? "access-row is-on" : "access-row"} onClick={() => toggle(item.id)} aria-pressed={on}>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}{on !== defaults.has(item.id) ? " · Changed from the role" : ""}</small>
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
