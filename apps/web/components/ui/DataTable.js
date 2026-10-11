import { initials } from "@synergifund/shared"
import { Spinner } from "./Spinner"
import { SortableList, useSortableRow } from "./Sortable"

export function DataTable({ columns, rows, selected, onToggle, onRow, empty, loading, selectable = true, compact = false, onMove }) {
  const table = (
    <table className={compact ? "grid is-compact" : "grid"}>
        <thead>
          <tr>
            {onMove && <th className="drag-col" aria-label="Reorder" />}
            {selectable && <th className="check-col" />}
            {columns.map((column) => (
              <th key={column.key} className={cellClass(column)}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0) + (onMove ? 1 : 0)} className="empty">{loading ? <Spinner /> : empty || "Nothing on file yet."}</td>
            </tr>
          )}
          {rows.map((row) => (
            onMove
              ? <SortableRow key={row.id} row={row} columns={columns} on={selected.includes(row.id)} onToggle={onToggle} onRow={onRow} selectable={selectable} />
              : <Row key={row.id} row={row} columns={columns} on={selected.includes(row.id)} onToggle={onToggle} onRow={onRow} selectable={selectable} />
          ))}
        </tbody>
      </table>
  )
  return (
    <div className="table-wrap">
      {onMove ? <SortableList ids={rows.map((row) => row.id)} onMove={onMove}>{table}</SortableList> : table}
    </div>
  )
}

function SortableRow(props) {
  const sortable = useSortableRow(props.row.id, true)
  return <Row {...props} sortable={sortable} />
}

function Row({ row, columns, on, onToggle, onRow, selectable, sortable }) {
  return (
              <tr ref={sortable?.ref} style={sortable?.style} className={[on ? "is-selected" : "", sortable?.dragging ? "is-dragging" : ""].filter(Boolean).join(" ") || undefined} onClick={() => onRow?.(row)}>
                {sortable && <td className="drag-col" onClick={(event) => event.stopPropagation()}>{sortable.handle}</td>}
                {selectable && (
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
                )}
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    data-label={column.label || undefined}
                    data-primary={index === 0 ? "true" : undefined}
                    className={cellClass(column)}
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
}

function cellClass(column) {
  return [column.pin === "right" && "pin-right", column.className].filter(Boolean).join(" ") || undefined
}
