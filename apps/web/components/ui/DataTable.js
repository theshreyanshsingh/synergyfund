import { initials } from "@synergifund/shared"

export function DataTable({ columns, rows, selected, onToggle, onRow, empty }) {
  return (
    <div className="table-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th className="check-col" />
            {columns.map((column) => (
              <th key={column.key} className={column.pin === "right" ? "pin-right" : undefined}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="empty">{empty || "Nothing on file yet."}</td>
            </tr>
          )}
          {rows.map((row) => {
            const on = selected.includes(row.id)
            return (
              <tr key={row.id} className={on ? "is-selected" : ""} onClick={() => onRow?.(row)}>
                <td className="check-col">
                  <button
                    type="button"
                    className={on ? "check on" : "check"}
                    aria-label={on ? "Deselect row" : "Select row"}
                    onClick={(event) => {
                      event.stopPropagation()
                      onToggle(row.id)
                    }}
                  />
                </td>
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    data-label={column.label || undefined}
                    data-primary={index === 0 ? "true" : undefined}
                    className={column.pin === "right" ? "pin-right" : undefined}
                  >
                    {column.avatar ? (
                      <span className="person">
                        <span className="avatar">{initials(column.avatar(row))}</span>
                        <span>{column.render ? column.render(row) : row[column.key]}</span>
                      </span>
                    ) : column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
