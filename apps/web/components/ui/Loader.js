export function Loader({ label = "Opening SynergiFund" }) {
  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="loader">
        <div className="loader-orbit" aria-hidden="true">
          <span className="loader-mark">S</span>
        </div>
        <p>{label}</p>
      </div>
    </div>
  )
}
