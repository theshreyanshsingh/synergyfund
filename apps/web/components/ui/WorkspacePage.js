"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Icon } from "./Icon"
import { Sparkline } from "./Sparkline"
import { DataTable } from "./DataTable"
import { HeaderActions } from "./HeaderActions"

export function WorkspacePage({
  action,
  secondary,
  stats = [],
  columns,
  rows = [],
  onRow,
  toolbar = true,
  customize = true,
  views = true,
  title,
  underTitle,
  lead,
  important,
  filters = [],
  empty,
  loading = false,
  selectable = true,
  compact = false,
  collapsible = false,
  openLabel,
  reorder,
  children,
}) {
  const [view, setView] = useState("default")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState([])
  const [hidden, setHidden] = useState([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [picked, setPicked] = useState({})
  // Columns with a `sort` (the value to order by) sort from their header, or the Sort list on a phone.
  const [sort, setSort] = useState(null)
  const filterRef = useRef(null)

  const visibleColumns = (columns || []).filter((column) => !hidden.includes(column.key))
  const filterGroups = filters
    .map((filter) => ({
      ...filter,
      options: [...new Set([...(filter.options || []), ...rows.map(filter.value)])].filter(Boolean),
    }))
    .filter((filter) => rows.some((row) => filter.value(row)))
  const activeFilters = (view === "important" ? 1 : 0) + Object.values(picked).filter(Boolean).length
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (view === "important" && important && !important(row)) return false
      if (filters.some((filter) => picked[filter.key] && filter.value(row) !== picked[filter.key])) return false
      if (!needle) return true
      return searchText(row).includes(needle)
    })
  }, [rows, query, view, important, filters, picked])
  const sortable = (columns || []).filter((column) => column.sort && column.label)
  const ordered = sortRows(shown, columns, sort)

  useEffect(() => {
    if (!filtersOpen) return
    function onDown(event) {
      if (!filterRef.current?.contains(event.target)) setFiltersOpen(false)
    }
    function onKey(event) {
      if (event.key === "Escape") setFiltersOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [filtersOpen])

  function pick(key, option) {
    setPicked((current) => ({ ...current, [key]: current[key] === option ? undefined : option }))
  }

  function clearFilters() {
    setView("default")
    setPicked({})
  }

  function sortBy(key) {
    setSort((current) => (current?.key !== key ? { key, dir: "asc" } : current.dir === "asc" ? { key, dir: "desc" } : null))
  }

  function toggle(id) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  return (
    <div className="workspace">
      <div className="workspace-top">
        <div className="page-heading">
          {title && <h1 className="page-title">{title}</h1>}
          {underTitle}
        {views && (
          <div className="views">
            <button type="button" className={view === "default" ? "view is-active" : "view"} onClick={() => setView("default")}>All</button>
            <button type="button" className={view === "important" ? "view is-active" : "view"} onClick={() => setView("important")}>Needs attention</button>
          </div>
        )}
        </div>
        {(action || secondary) && (
          <HeaderActions>
            {secondary && (
              <button type="button" className="import-button" disabled={secondary.disabled} aria-busy={secondary.busy || undefined} onClick={secondary.onClick}>
                {secondary.busy && <span className="spinner spinner-sm tw:animate-spin" />}
                {secondary.label}
              </button>
            )}
            {action && (
              <button type="button" className="primary" onClick={action.onClick}>
                <Icon name="plus" size={14} />
                {action.label}
              </button>
            )}
          </HeaderActions>
        )}
      </div>
      {lead}
      {stats.length > 0 && (
        <div className="stats">
          {stats.map((stat) => (
            <article key={stat.key || stat.label} className="stat">
              <div className="stat-label">
                {stat.label}
                {stat.trend === "up" && <span className="trend">↑</span>}
              </div>
              <div className="stat-value">
                {stat.value}
                {stat.aside && <small>{stat.aside}</small>}
              </div>
              <div className="stat-hint">{stat.hint}</div>
              <Sparkline values={stat.series || []} />
            </article>
          ))}
        </div>
      )}
      {children || (
        <section className="panel">
          {toolbar && (
            <div className="toolbar">
              <div className="toolbar-left">
                {(important || filterGroups.length > 0) && (
                  <div className="filter-anchor" ref={filterRef}>
                    <button type="button" className={activeFilters ? "tool is-active" : "tool"} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
                      <Icon name="filter" size={14} /> Filters{activeFilters ? ` · ${activeFilters}` : ""}
                    </button>
                    {filtersOpen && (
                      <div className="pop filter-pop">
                        {important && (
                          <div className="filter-group">
                            <span>Show</span>
                            <div className="filter-chips">
                              <button type="button" className={view === "default" ? "is-on" : undefined} onClick={() => setView("default")}>All records</button>
                              <button type="button" className={view === "important" ? "is-on" : undefined} onClick={() => setView("important")}>Needs attention</button>
                            </div>
                          </div>
                        )}
                        {filterGroups.map((filter) => (
                          <div key={filter.key} className="filter-group">
                            <span>{filter.label}</span>
                            <div className="filter-chips">
                              {filter.options.map((option) => (
                                <button key={option} type="button" className={picked[filter.key] === option ? "is-on" : undefined} onClick={() => pick(filter.key, option)}>{option}</button>
                              ))}
                            </div>
                          </div>
                        ))}
                        {activeFilters > 0 && <button type="button" className="filter-clear" onClick={clearFilters}>Clear filters</button>}
                      </div>
                    )}
                  </div>
                )}
                <label className="search">
                  <Icon name="search" size={14} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
                </label>
                {sortable.length > 0 && (
                  <label className="sort-select">
                    <span>Sort</span>
                    <select value={sort ? `${sort.key}:${sort.dir}` : ""} onChange={(event) => { const [key, dir] = event.target.value.split(":"); setSort(key ? { key, dir } : null) }}>
                      <option value="">Default order</option>
                      {sortable.flatMap((column) => {
                        const words = rows.some((row) => typeof column.sort(row) === "string" && column.sort(row) !== "")
                        return [
                          <option key={`${column.key}:asc`} value={`${column.key}:asc`}>{column.label}, {words ? "A to Z" : "low to high"}</option>,
                          <option key={`${column.key}:desc`} value={`${column.key}:desc`}>{column.label}, {words ? "Z to A" : "high to low"}</option>,
                        ]
                      })}
                    </select>
                  </label>
                )}
              </div>
              {customize && (
                <div className="toolbar-right">
                  <button type="button" className="tool" onClick={() => setCustomizeOpen((open) => !open)}>
                    <Icon name="sliders" size={14} /> Customize
                  </button>
                  {customizeOpen && columns && (
                    <div className="pop pop-right">
                      {columns.filter((column) => column.label).map((column) => (
                        <label key={column.key}>
                          <input
                            type="checkbox"
                            checked={!hidden.includes(column.key)}
                            onChange={() => setHidden((current) => current.includes(column.key) ? current.filter((key) => key !== column.key) : [...current, column.key])}
                          />
                          {column.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {reorder && (shown.length !== rows.length || sort) && rows.length > 1 && <p className="reorder-note">Clear the search{sort ? ", the sort" : ""} and filters to drag properties into a new order.</p>}
          <DataTable columns={visibleColumns} rows={ordered} selected={selected} onToggle={toggle} onRow={onRow} empty={rows.length > 0 ? "Nothing matches your search or filters." : empty} loading={loading} selectable={selectable} compact={compact} collapsible={collapsible} openLabel={openLabel} onMove={reorder && shown.length === rows.length && !sort ? reorder.onMove : null} sort={sort} onSort={sortable.length ? sortBy : null} />
        </section>
      )}
    </div>
  )
}

// Rows in the order of one column (blank values last either way), or as given when nothing is sorted.
function sortRows(rows, columns, sort) {
  const column = sort && (columns || []).find((item) => item.key === sort.key && item.sort)
  if (!column) return rows
  const value = (row) => {
    const result = column.sort(row)
    return result == null || result === "" || (typeof result === "number" && !Number.isFinite(result)) ? null : result
  }
  const factor = sort.dir === "desc" ? -1 : 1
  return [...rows].sort((a, b) => {
    const left = value(a)
    const right = value(b)
    if (left == null || right == null) return left == null && right == null ? 0 : left == null ? 1 : -1
    if (typeof left === "number" && typeof right === "number") return (left - right) * factor
    return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" }) * factor
  })
}

function searchText(value) {
  if (value == null) return ""
  if (typeof value === "object") return Object.values(value).map(searchText).join(" ")
  return String(value).toLowerCase()
}
