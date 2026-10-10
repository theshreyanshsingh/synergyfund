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
  children,
}) {
  const [view, setView] = useState("default")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState([])
  const [hidden, setHidden] = useState([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [picked, setPicked] = useState({})
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
              </div>
              {customize && (
                <div className="toolbar-right">
                  <button type="button" className="tool" onClick={() => setCustomizeOpen((open) => !open)}>
                    <Icon name="sliders" size={14} /> Customize
                  </button>
                  {customizeOpen && columns && (
                    <div className="pop pop-right">
                      {columns.map((column) => (
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
          <DataTable columns={visibleColumns} rows={shown} selected={selected} onToggle={toggle} onRow={onRow} empty={rows.length > 0 ? "Nothing matches your search or filters." : empty} loading={loading} selectable={selectable} compact={compact} />
        </section>
      )}
    </div>
  )
}

function searchText(value) {
  if (value == null) return ""
  if (typeof value === "object") return Object.values(value).map(searchText).join(" ")
  return String(value).toLowerCase()
}
