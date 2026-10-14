import { companyExposure } from "@synergifund/shared"

// A small badge for how many properties a company holds: Low (1–2), Moderate (3–4), High (5–7), Critical (8+).
export function ExposureBadge({ count }) {
  const level = companyExposure(count)
  if (!level) return null
  return <span className={`exposure is-${level.id}`} title={`${count} ${count === 1 ? "property" : "properties"}`}>{level.label}</span>
}
