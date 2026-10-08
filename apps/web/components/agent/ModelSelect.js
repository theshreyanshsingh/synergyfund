"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Icon } from "../ui/Icon"

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })

function price(model) {
  if (model.input == null || model.output == null) return "Price not listed"
  return `${dollars.format(model.input)} in · ${dollars.format(model.output)} out per 1M`
}

function context(model) {
  if (!model.context) return ""
  return model.context >= 1000000 ? `${Math.round(model.context / 100000) / 10}M context` : `${Math.round(model.context / 1000)}K context`
}

export function ModelSelect({ label, hint, value, models, loading, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const ref = useRef(null)
  const listRef = useRef(null)
  const selected = models.find((model) => model.id === value)

  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return models
    return models.filter((model) => {
      const text = `${model.name} ${model.id} ${model.provider}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
  }, [models, query])

  useEffect(() => {
    if (!open) return
    function onDown(event) {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    setQuery("")
    const index = Math.max(0, models.findIndex((model) => model.id === value))
    setActive(index)
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "center" }))
  }, [open, models, value])

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  function choose(model) {
    onChange(model.id)
    setOpen(false)
  }

  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault()
      setOpen(false)
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((current) => Math.min(filtered.length - 1, current + 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((current) => Math.max(0, current - 1))
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (filtered[active]) choose(filtered[active])
    }
  }

  let lastProvider = ""
  return (
    <div className="field settings-wide model-select" ref={ref}>
      <span>{label}<em> · {hint}</em></span>
      <button type="button" className="model-select-button" aria-haspopup="listbox" aria-expanded={open} disabled={loading && !selected} onClick={() => setOpen((current) => !current)}>
        <span className="model-select-value">
          <b>{selected?.name || value || "Choose a model"}</b>
          <small>{selected ? `${selected.provider} · ${price(selected)}` : loading ? "Loading models…" : value}</small>
        </span>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="model-select-menu">
          <label className="model-select-search">
            <Icon name="search" size={14} />
            <input
              autoFocus
              value={query}
              placeholder="Search models"
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
              }}
              onKeyDown={onKey}
            />
          </label>
          <div className="model-select-list" role="listbox" ref={listRef}>
            {filtered.length === 0 && <p className="model-select-empty">No model matches “{query}”.</p>}
            {filtered.map((model, index) => {
              const heading = model.provider !== lastProvider ? model.provider : ""
              lastProvider = model.provider
              return (
                <div key={model.id}>
                  {heading && <p className="model-select-group">{heading}</p>}
                  <button
                    type="button"
                    role="option"
                    data-index={index}
                    aria-selected={model.id === value}
                    className={`${index === active ? "is-active" : ""} ${model.id === value ? "is-on" : ""}`.trim() || undefined}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(model)}
                  >
                    <span>
                      <b>{model.name}</b>
                      <small>{[price(model), context(model)].filter(Boolean).join(" · ")}</small>
                    </span>
                    {model.id === value && <Icon name="tick" size={14} />}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
