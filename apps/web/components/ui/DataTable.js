import { useState } from "react"
import { initials } from "@synergifund/shared"
import { Icon } from "./Icon"
import { Spinner } from "./Spinner"
import { SortableList, useSortableRow } from "./Sortable"

const PHONE = "(max-width: 760px)"

// `collapsible`: on phones each row shows only its name (and any `peek` columns). The first tap opens up its details
// with an Open button, the second tap opens it, like a tap on a computer does straight away.
export function DataTable({ columns, rows, selected, onToggle, onRow, empty, loading, selectable = true, compact = false, onMove, collapsible = false, openLabel = "Open" }) {
  const [expanded, setExpanded] = useState("")
  // Only a row that opens something can fold; otherwise its details would be out of reach.
  const folding = collapsible && Boolean(onRow)
  function tap(row) {
    if (folding && expanded !== row.id && window.matchMedia(PHONE).matches) {
      setExpanded(row.id)
      return
    }
    onRow?.(row)
  }
  const fold = (row) => (folding ? (expanded === row.id ? "expanded" : "collapsed") : "")
  const table = (
    <table className={["grid", compact ? "is-compact" : "", folding ? "is-collapsible" : ""].filter(Boolean).join(" ")}>
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
              ? <SortableRow key={row.id} row={row} columns={columns} on={selected.includes(row.id)} onToggle={onToggle} onRow={onRow ? tap : undefined} onOpen={onRow} selectable={selectable} fold={fold(row)} openLabel={openLabel} />
              : <Row key={row.id} row={row} columns={columns} on={selected.includes(row.id)} onToggle={onToggle} onRow={onRow ? tap : undefined} onOpen={onRow} selectable={selectable} fold={fold(row)} openLabel={openLabel} />
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

function Row({ row, columns, on, onToggle, onRow, onOpen, selectable, sortable, fold = "", openLabel }) {
  return (
              <tr ref={sortable?.ref} style={sortable?.style} className={[on ? "is-selected" : "", sortable?.dragging ? "is-dragging" : "", fold ? `is-${fold}` : ""].filter(Boolean).join(" ") || undefined} onClick={() => onRow?.(row)} data-row-id={row.id}>
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
                {fold && onOpen && (
                  // Phones only: the chevron on a folded row, and Open on an opened one.
                  <td className="fold-col">
                    {fold === "expanded" ? (
                      <button type="button" className="fold-open" onClick={(event) => { event.stopPropagation(); onOpen(row) }}>
                        {typeof openLabel === "function" ? openLabel(row) : openLabel} <Icon name="chevron" size={14} />
                      </button>
                    ) : <span className="fold-chevron" aria-hidden="true"><Icon name="chevron" size={16} /></span>}
                  </td>
                )}
              </tr>
  )
}

function cellClass(column) {
  return [column.pin === "right" && "pin-right", column.peek && "peek-col", column.className].filter(Boolean).join(" ") || undefined
}
