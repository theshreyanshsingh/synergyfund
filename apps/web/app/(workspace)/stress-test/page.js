"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { STRESS_INPUTS, STRESS_PROBLEMS, STRESS_RULES, STRESS_SERIOUS, stressScenario, stressTest } from "@synergifund/shared"
import { dayLabel } from "../../../components/properties/FinancingSection"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { money } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"

// Starting points for the what-ifs: no change, a bad year (each what-if's start), and a 2008-style crash.
const PRESETS = [
  { label: "No change", values: { valueDrop: 0, rentDrop: 0, rateRise: 0, rehabOverrun: 0, refinanceLtv: 75, months: 12 } },
  { label: "Bad year", values: stressScenario({}) },
  { label: "2008-style crash", values: { valueDrop: 30, rentDrop: 15, rateRise: 3, rehabOverrun: 30, refinanceLtv: 60, months: 18 } },
]

const percent = (value) => (value == null ? "—" : `${Math.round(value * 100)}%`)
const times = (value) => (value == null ? "—" : `${value.toFixed(2)}×`)
const signed = (value) => (value == null ? "—" : value < 0 ? `−${money(-value)}` : money(value))
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`
const sameValues = (a, b) => STRESS_INPUTS.every((item) => Number(a[item.key]) === Number(b[item.key]))

export default function StressTestPage() {
  const router = useRouter()
  const source = useApi("/stress-test")
  const [scenario, setScenario] = useState(() => stressScenario({}))
  const data = source.data
  const result = useMemo(() => (data ? stressTest(data.rows, scenario, data.today) : null), [data, scenario])
  const months = scenario.months

  const lead = result && (
    <div className="stress">
      <p className="stress-intro">
        What a bad market does to the {plural(result.houses.length, "house")} we own. Move the what-ifs and every number follows.
        {data.leftOut.notBought + data.leftOut.sold > 0 && ` Leaves out ${[data.leftOut.notBought && `${data.leftOut.notBought} not bought yet`, data.leftOut.sold && `${data.leftOut.sold} sold or exited`].filter(Boolean).join(" and ")}.`}
      </p>

      <section className="panel stress-panel" aria-label="What-ifs">
        <div className="stress-presets" role="group" aria-label="Start from">
          {PRESETS.map((preset) => (
            <button key={preset.label} type="button" className={sameValues(scenario, preset.values) ? "is-on" : ""} onClick={() => setScenario({ ...preset.values })}>{preset.label}</button>
          ))}
        </div>
        <div className="stress-inputs">
          {STRESS_INPUTS.map((item) => (
            <label key={item.key} className="stress-input">
              <span>{item.label}</span>
              <strong>{scenario[item.key]}{item.unit}</strong>
              <input type="range" name={item.key} min={item.min} max={item.max} step={item.step} value={scenario[item.key]} onChange={(event) => setScenario((current) => ({ ...current, [item.key]: Number(event.target.value) }))} />
            </label>
          ))}
        </div>
        <p className="stress-rules">
          Refinances at {result.refinanceRate.toFixed(2)}% ({STRESS_RULES.refinanceRate}% plus the rise) over 30 years, for the smaller of {scenario.refinanceLtv}% of the value and what the rent carries with the rent covering the new payment, taxes and insurance at least {STRESS_RULES.minDscr}×. Houses for sale, and flips that aren't rented or up for rent, are sold instead, losing {STRESS_RULES.sellingCostPercent}% to agents and closing. A sold house costs nothing after the sale, a refinanced one pays the new payment from then on, and loans that don't come due keep their payments.
        </p>
      </section>

      <section className="panel stress-cash">
        <div>
          <span className="stress-eyebrow">Cash needed over the next {months} months</span>
          <strong className="stress-big">{money(result.cash.total)}</strong>
          <span className="stress-sub">{result.atRisk ? `${plural(result.atRisk, "house")} at risk` : "No house at risk"} · through {dayLabel(result.until)}</span>
        </div>
        <dl className="stress-lines">
          <div><dt>Short when loans come due</dt><dd>{money(result.cash.shortfalls)}</dd><small>The new loan or the sale doesn't cover the old loans</small></div>
          <div><dt>Holding costs</dt><dd>{money(result.cash.holding)}</dd><small>Payments, taxes and insurance on houses with no rent, until they are sold or refinanced</small></div>
          <div><dt>Rentals losing money</dt><dd>{money(result.cash.rentalLosses)}</dd><small>Rent under the scenario doesn't cover the costs</small></div>
          <div><dt>Rehab overruns</dt><dd>{money(result.cash.overruns)}</dd><small>{data.seesRehab ? `${scenario.rehabOverrun}% over on the rehab still to do` : "Not counted: needs access to draws"}</small></div>
          <div className="stress-back"><dt>Coming back</dt><dd>{money(result.cash.rentSurplus + result.cash.cashOut)}</dd><small>{money(result.cash.rentSurplus)} rent left over on rentals that make money{result.cash.cashOut ? `, ${money(result.cash.cashOut)} more from refinances and sales than the loans they pay off` : ""}</small></div>
        </dl>
      </section>

      <section className="panel stress-compare" aria-label="Today and under the scenario">
        <table>
          <thead><tr><th scope="col" /><th scope="col">Today</th><th scope="col">Under the scenario</th></tr></thead>
          <tbody>
            <tr><th scope="row">Value</th><td>{money(result.today.value)}</td><td>{money(result.stressed.value)}</td></tr>
            <tr><th scope="row">Loans{result.today.debtWithoutValue > 0 && <small>{money(result.today.debtWithoutValue)} on houses with no value, left out of equity and loan to value</small>}</th><td>{money(result.today.debt)}</td><td>{money(result.stressed.debt)}</td></tr>
            <tr><th scope="row">Equity</th><td>{signed(result.today.equity)}</td><td className={result.stressed.equity < 0 ? "is-bad" : ""}>{signed(result.stressed.equity)}</td></tr>
            <tr><th scope="row">Loan to value</th><td>{percent(result.today.ltv)}</td><td className={result.stressed.ltv > 0.8 ? "is-bad" : ""}>{percent(result.stressed.ltv)}</td></tr>
            <tr><th scope="row">Rent a month</th><td>{money(result.today.rent)}</td><td>{money(result.stressed.rent)}</td></tr>
            <tr><th scope="row">Costs a month</th><td>{money(result.today.carry)}</td><td>{money(result.stressed.carry)}</td></tr>
            <tr><th scope="row">Cash flow a month</th><td>{signed(result.today.cashFlow)}</td><td className={result.stressed.cashFlow < 0 ? "is-bad" : ""}>{signed(result.stressed.cashFlow)}</td></tr>
            <tr><th scope="row">Rent cover on rentals</th><td>{times(result.today.rentCover)}</td><td className={result.stressed.rentCover != null && result.stressed.rentCover < STRESS_RULES.minDscr ? "is-bad" : ""}>{times(result.stressed.rentCover)}</td></tr>
          </tbody>
        </table>
      </section>

      <div className="stress-pair">
        <section className="panel stress-chart">
          <h2>Loans coming due</h2>
          <p className="property-missing">Open loans by maturity date, the next {months} months.</p>
          <Bars rows={result.maturities.map((bucket) => ({ name: bucket.label, amount: bucket.balance, note: bucket.loans ? plural(bucket.loans, "loan") : "None", bad: bucket.past }))} />
        </section>
        <Concentration concentration={result.concentration} />
      </div>

      <Gaps gaps={result.gaps} soldWithOpenLoans={data.leftOut.soldWithOpenLoans} />
    </div>
  )

  return (
    <WorkspacePage
      views={false}
      title="Stress Test"
      loading={!source.data && !source.error}
      lead={lead}
      columns={[
        { key: "address", label: "Property", sort: (row) => row.address, render: (row) => <span className="person-copy"><strong>{row.address}</strong><small>{[row.city, row.stage].filter(Boolean).join(" · ")}</small></span> },
        { key: "problems", label: "What goes wrong", render: (row) => <Problems list={row.problems} /> },
        { key: "cashNeeded", label: "Cash needed", className: "num", peek: true, sort: (row) => row.cashNeeded, render: (row) => (row.cashNeeded ? money(row.cashNeeded) : "—") },
        { key: "exit", label: "When the loan comes due", sort: (row) => row.exit?.date || "", render: (row) => <ExitCell house={row} ltv={scenario.refinanceLtv} /> },
        { key: "stressedValue", label: "Value", className: "num", sort: (row) => row.stressedValue, render: (row) => <Pair now={row.stressedValue} before={row.value} title={row.valueNote} /> },
        { key: "debt", label: "Loans", className: "num", sort: (row) => row.debt, render: (row) => money(row.debt) },
        { key: "stressedLtv", label: "Loan to value", className: "num", sort: (row) => row.stressedLtv, render: (row) => <span className={row.stressedLtv > 1 ? "stress-bad" : undefined}>{percent(row.stressedLtv)}</span> },
        { key: "stressedCashFlow", label: "Cash flow a month", className: "num", sort: (row) => row.stressedCashFlow, render: (row) => <span className={row.stressedCashFlow < 0 ? "stress-bad" : undefined}>{signed(row.stressedCashFlow)}</span> },
      ]}
      rows={result?.houses || []}
      filters={[
        { key: "problem", label: "Worst problem", value: (row) => row.problems[0] || "Holds up", options: [...STRESS_PROBLEMS, "Holds up"] },
        { key: "stage", label: "Stage", value: (row) => row.stage },
        { key: "company", label: "Company", value: (row) => row.company },
      ]}
      important={(row) => row.problems.some((problem) => STRESS_SERIOUS.includes(problem))}
      onRow={(row) => router.push(`/properties/${row.id}?tab=financing`)}
      collapsible
      openLabel={() => "Open property"}
      empty={source.error ? `The stress test didn't load (${source.error}). Reload the page to try again.` : "No owned houses to test yet."}
    />
  )
}

function Problems({ list }) {
  if (!list.length) return <span className="stress-fine">Holds up</span>
  return (
    <span className="stress-problems">
      {list.map((problem) => <span key={problem} className={`pill ${STRESS_SERIOUS.includes(problem) ? "tone-bad" : "tone-neutral"}`}>{problem}</span>)}
    </span>
  )
}

function ExitCell({ house, ltv }) {
  const exit = house.exit
  if (!exit) return <span className="person-copy"><span>Not in the window</span>{house.nextMaturity && <small>Due {dayLabel(house.nextMaturity)}</small>}</span>
  const when = `${exit.past ? "Matured" : "Due"} ${dayLabel(exit.date)}`
  if (exit.kind === "Sale") {
    return <span className="person-copy"><span>{when} · sold</span><small>{exit.proceeds == null ? "No value to sell at" : `${money(exit.proceeds)} after costs${exit.shortfall ? `, ${money(exit.shortfall)} short` : ""}`}</small></span>
  }
  return (
    <span className="person-copy">
      <span>{when} · refinanced</span>
      <small>{exit.newLoan == null ? "No value to refinance on" : `New loan ${money(exit.newLoan)} (${exit.limitedBy === "rent" ? "held back by the rent" : `${ltv}% of value`})${exit.shortfall ? `, ${money(exit.shortfall)} short` : exit.cashOut ? `, ${money(exit.cashOut)} cash out` : ""}`}</small>
    </span>
  )
}

function Pair({ now, before, title }) {
  if (now == null) return <span className="stress-bad">No value</span>
  return <span className="person-copy" title={title}><span>{money(now)}</span><small>{money(before)} today</small></span>
}

// Horizontal bars, each the share of the largest.
function Bars({ rows }) {
  const top = Math.max(1, ...rows.map((row) => row.amount))
  if (!rows.length) return <p className="property-missing">Nothing on file.</p>
  return (
    <ul className="stress-bars">
      {rows.map((row) => (
        <li key={row.name} className={row.bad ? "is-bad" : row.warn ? "is-warn" : ""}>
          <span className="stress-bar-name">{row.name}</span>
          <span className="stress-bar-track"><span style={{ width: `${(row.amount / top) * 100}%` }} /></span>
          <span className="stress-bar-value">{row.amount ? money(row.amount) : "—"}<small>{row.note}</small></span>
        </li>
      ))}
    </ul>
  )
}

const CONCENTRATION = [
  { key: "lenders", label: "Lenders", hint: "Share of the loans with each lender." },
  { key: "markets", label: "Markets", hint: "Share of the value in each city." },
  { key: "companies", label: "Companies", hint: "Share of the value in each owning company." },
]

// Over a third with one lender, market or company is a lot riding on one name.
function Concentration({ concentration }) {
  const [view, setView] = useState("lenders")
  const current = CONCENTRATION.find((item) => item.key === view)
  return (
    <section className="panel stress-chart">
      <h2>Where it's concentrated</h2>
      <div className="property-switch" role="tablist" aria-label="Concentration">
        {CONCENTRATION.map((item) => <button key={item.key} type="button" role="tab" aria-selected={view === item.key} className={view === item.key ? "is-on" : ""} onClick={() => setView(item.key)}>{item.label}</button>)}
      </div>
      <p className="property-missing">{current.hint} Over a third on one name is flagged.</p>
      <Bars rows={concentration[view].map((row) => ({ name: row.name, amount: row.amount, note: percent(row.share), warn: !row.others && row.share > 1 / 3 }))} />
    </section>
  )
}

// What the numbers couldn't include, so a blank never reads as good news.
function Gaps({ gaps, soldWithOpenLoans }) {
  const lines = [
    gaps.noValue && `${plural(gaps.noValue, "house")} with no ARV or purchase price (left out of value and equity)`,
    gaps.noRent && `${plural(gaps.noRent, "rented house")} with no rent entered`,
    gaps.rentFromMarket && `${plural(gaps.rentFromMarket, "rented house")} using market rent (no actual rent entered)`,
    gaps.noMaturity && `${plural(gaps.noMaturity, "loan")} with no maturity date (never counted as coming due)`,
    gaps.noBalance && `${plural(gaps.noBalance, "loan")} with no current amount`,
    gaps.paymentEstimated && `${plural(gaps.paymentEstimated, "loan")} with no payment, counted as interest only`,
    gaps.noPayment && `${plural(gaps.noPayment, "loan")} with no payment or rate (counted as $0 a month)`,
    gaps.noTaxes && `${plural(gaps.noTaxes, "house")} with no property taxes entered`,
    gaps.noInsurance && `${plural(gaps.noInsurance, "house")} with no insurance payment entered`,
    soldWithOpenLoans && `${plural(soldWithOpenLoans, "sold house")} with a loan still open, left out here (mark the loan Paid Off if the sale paid it)`,
  ].filter(Boolean)
  if (!lines.length) return null
  return (
    <section className="panel stress-gaps">
      <h2>Missing from the numbers</h2>
      <ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul>
    </section>
  )
}

