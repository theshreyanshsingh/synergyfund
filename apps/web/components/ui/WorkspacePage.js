"use client"

import { useMemo, useState } from "react"
import { Icon } from "./Icon"
import { Sparkline } from "./Sparkline"
import { DataTable } from "./DataTable"

export function WorkspacePage({
  action,
  secondary,
  stats = [],
  columns,
  rows = [],
  onRow,
  toolbar = true,
  views = true,
  title,
  underTitle,
  lead,
  important,
  empty,
  children,
}) {
  const [view, setView] = useState("default")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState([])
  const [hidden, setHidden] = useState([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)

  const visibleColumns = (columns || []).filter((column) => !hidden.includes(column.key))
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (view === "important" && important && !important(row)) return false
      if (!needle) return true
      return JSON.stringify(row).toLowerCase().includes(needle)
    })
  }, [rows, query, view, important])

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
          <div className="draws-actions">
            {secondary && (
              <button type="button" className="import-button" onClick={secondary.onClick}>{secondary.label}</button>
            )}
            {action && (
              <button type="button" className="primary" onClick={action.onClick}>
                <Icon name="plus" size={14} />
                {action.label}
              </button>
            )}
          </div>
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
                <button type="button" className="tool" onClick={() => setFiltersOpen((open) => !open)}>
                  <Icon name="filter" size={14} /> Filters
                </button>
                {filtersOpen && (
                  <div className="pop pop-inline">
                    <button type="button" onClick={() => { setView("default"); setFiltersOpen(false) }}>All records</button>
                    <button type="button" onClick={() => { setView("important"); setFiltersOpen(false) }}>Needs attention</button>
                  </div>
                )}
                <label className="search">
                  <Icon name="search" size={14} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
                </label>
              </div>
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
            </div>
          )}
          <DataTable columns={visibleColumns} rows={shown} selected={selected} onToggle={toggle} onRow={onRow} empty={empty} />
        </section>
      )}
    </div>
  )
}
