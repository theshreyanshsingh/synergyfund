export function Sparkline({ values = [] }) {
  if (values.length < 2) return null
  const width = 112
  const height = 28
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - 3 - ((value - min) / span) * (height - 8)
    return [x, y]
  })
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(" ")
  const area = `${line} L${width} ${height} L0 ${height} Z`
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <path d={area} className="spark-area" />
      <path d={line} className="spark-line" />
    </svg>
  )
}
