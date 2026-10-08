export function Spinner({ size = "md", label = "Loading" }) {
  return <span className={`spinner spinner-${size} tw:animate-spin`} role="status" aria-label={label} />
}

export function PageSpinner({ label }) {
  return (
    <div className="page-spinner">
      <Spinner size="lg" label={label} />
    </div>
  )
}
