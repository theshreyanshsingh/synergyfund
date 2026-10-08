export function Icon({ name, size = 16 }) {
  const Draw = icons[name] || icons.grid
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <Draw />
    </svg>
  )
}

function Search() { return <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></> }
function Spark() { return <path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8L12 3z" /> }
function Bell() { return <><path d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 7H3s3 0 3-7" /><path d="M10 19a2 2 0 0 0 4 0" /></> }
function Home() { return <><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10.5V20h12v-9.5" /></> }
function Chat() { return <path d="M5 6h14v9H8l-3 3V6z" /> }
function Grid() { return <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></> }
function Check() { return <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12.5l2.5 2.5L16 9.5" /></> }
function Card() { return <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></> }
function Calendar() { return <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></> }
function Building() { return <><path d="M4 20V6l8-3 8 3v14" /><path d="M9 20v-5h6v5" /></> }
function Layers() { return <path d="M12 3 3 8l9 5 9-5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5" /> }
function Chart() { return <path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" /> }
function Bank() { return <><path d="M3 10h18L12 4 3 10z" /><path d="M5 10v7M10 10v7M14 10v7M19 10v7M3 20h18" /></> }
function Receipt() { return <><path d="M7 3h10v18l-2-1.2L13 21l-2-1.2L9 21l-2-1.2L5 21V3h2z" /><path d="M9 8h6M9 12h6" /></> }
function File() { return <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></> }
function Pulse() { return <path d="M3 12h4l2-5 4 10 2-5h6" /> }
function Alert() { return <><path d="M12 4 3 19h18L12 4z" /><path d="M12 10v4M12 16.5h.01" /></> }
function Users() { return <><path d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20" /><circle cx="10" cy="8" r="3" /><path d="M20 20v-1.2A3.2 3.2 0 0 0 17 15.7M16 5.2a3 3 0 0 1 0 5.6" /></> }
function Chevron() { return <path d="M6 9l6 6 6-6" /> }
function Plus() { return <path d="M12 5v14M5 12h14" /> }
function Filter() { return <path d="M4 6h16M7 12h10M10 18h4" /> }
function Sliders() { return <><path d="M4 8h16M4 16h16" /><circle cx="9" cy="8" r="1.6" fill="currentColor" /><circle cx="15" cy="16" r="1.6" fill="currentColor" /></> }
function Logout() { return <path d="M10 7V5H5v14h5v-2M10 12h9M16 9l3 3-3 3" /> }
function Settings() { return <><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></> }
function Help() { return <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.8.4-1.2.9-1.2 1.8V14" /><path d="M12 17h.01" /></> }
function Sun() { return <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></> }
function Moon() { return <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" /> }
function Menu() { return <><path d="M4 7h16M4 12h16M4 17h16" /></> }
function More() { return <><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></> }
function Close() { return <path d="M6 6l12 12M18 6 6 18" /> }

const icons = { search: Search, spark: Spark, bell: Bell, home: Home, chat: Chat, grid: Grid, check: Check, card: Card, calendar: Calendar, building: Building, layers: Layers, chart: Chart, bank: Bank, receipt: Receipt, file: File, pulse: Pulse, alert: Alert, users: Users, chevron: Chevron, plus: Plus, filter: Filter, sliders: Sliders, logout: Logout, settings: Settings, help: Help, sun: Sun, moon: Moon, menu: Menu, more: More, close: Close }
