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
// A dashed chat bubble: a temporary chat that is not kept in History.
function TempChat() { return <path d="M5 6h14v9H8l-3 3V6z" strokeDasharray="2.6 2.4" /> }
function Grid() { return <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></> }
function Check() { return <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12.5l2.5 2.5L16 9.5" /></> }
function Card() { return <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></> }
function Calendar() { return <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></> }
function Building() { return <><path d="M4 20V6l8-3 8 3v14" /><path d="M9 20v-5h6v5" /></> }
function Layers() { return <path d="M12 3 3 8l9 5 9-5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5" /> }
function Chart() { return <path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" /> }
// Office buildings (Companies): a tall tower and a shorter one, with windows.
function Buildings() { return <><path d="M3 21h18" /><path d="M5 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16" /><path d="M14 10h4a1 1 0 0 1 1 1v10" /><path d="M8 8h3M8 11.5h3M8 15h3M16.5 14h.01M16.5 17.5h.01" /></> }
function Briefcase() { return <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18" /></> }
function Folder() { return <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2.2 2.2h7.3A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /> }
function Download() { return <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" /> }
function Upload() { return <path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 20h14" /> }
function Copy() { return <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></> }
function Eye() { return <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></> }
function Play() { return <path d="M7 5.5v13l11-6.5z" /> }
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
// A gear: eight teeth around a hub.
function Settings() { return <><path d="M10.19 5.24 L10.53 2.72 L13.47 2.72 L13.81 5.24 L15.50 5.94 L17.53 4.40 L19.60 6.47 L18.06 8.50 L18.76 10.19 L21.28 10.53 L21.28 13.47 L18.76 13.81 L18.06 15.50 L19.60 17.53 L17.53 19.60 L15.50 18.06 L13.81 18.76 L13.47 21.28 L10.53 21.28 L10.19 18.76 L8.50 18.06 L6.47 19.60 L4.40 17.53 L5.94 15.50 L5.24 13.81 L2.72 13.47 L2.72 10.53 L5.24 10.19 L5.94 8.50 L4.40 6.47 L6.47 4.40 L8.50 5.94Z" /><circle cx="12" cy="12" r="3" /></> }
function Help() { return <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.8.4-1.2.9-1.2 1.8V14" /><path d="M12 17h.01" /></> }
function Sun() { return <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></> }
function Moon() { return <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" /> }
function Menu() { return <><path d="M4 7h16M4 12h16M4 17h16" /></> }
function Mic() { return <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></> }
function Stop() { return <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /> }
function ArrowUp() { return <path d="M12 19V5M6 11l6-6 6 6" /> }
function Tick() { return <path d="M5 12.5l4.5 4.5L19 7.5" /> }
function Mail() { return <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></> }
function History() { return <><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" /><path d="M4 4v4.5h4.5M12 8v4l3 2" /></> }
function Trash() { return <><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></> }
function Globe() { return <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" /></> }
function More() { return <><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></> }
function Close() { return <path d="M6 6l12 12M18 6 6 18" /> }

function Hash() { return <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" /> }
function Lock() { return <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></> }
function Paperclip() { return <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /> }
function Smile() { return <><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" /></> }
function At() { return <><circle cx="12" cy="12" r="4" /><path d="M16 8v5a2.5 2.5 0 0 0 5 0v-1a9 9 0 1 0-3.5 7.1" /></> }
function Reply() { return <path d="M5 6h14v9H9l-4 3V6zM9 10h6" /> }
function Edit() { return <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /> }
function Back() { return <path d="M15 18l-6-6 6-6" /> }
function Grip() { return <><circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none" /></> }
function Phone() { return <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /> }
function PhoneOff() { return <><path d="M10.7 13.3a11 11 0 0 1-2.2-3.8L11 8 9 3H5a2 2 0 0 0-2 2 16 16 0 0 0 4.4 11.6" /><path d="M10.6 17.6A16 16 0 0 0 18 20a2 2 0 0 0 2-2v-4l-5-2-1.5 2.5" /><path d="M3 21 21 3" /></> }
function Video() { return <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></> }
function VideoOff() { return <><path d="M16 16v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m4 0h3a2 2 0 0 1 2 2v3.5l5-3.5v10" /><path d="M3 3l18 18" /></> }
function MicOff() { return <><path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5 2.2" /><path d="M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11.1 5.7M12 18v3M3 3l18 18" /></> }
function Screen() { return <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4M12 13V7M9 10l3-3 3 3" /></> }
function Expand() { return <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /> }
function Shrink() { return <path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7" /> }
function ArrowIn() { return <path d="M17 7 7 17M7 9v8h8" /> }
function ArrowOut() { return <path d="M7 17 17 7M9 7h8v8" /> }

function Popout() { return <><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" stroke="none" /></> }
function UserPlus() { return <><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0M19 8v6M16 11h6" /></> }
function Link() { return <><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></> }
function Share() { return <><path d="M12 15V3M8 7l4-4 4 4" /><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" /></> }

const icons = { popout: Popout, userPlus: UserPlus, link: Link, share: Share, phone: Phone, phoneOff: PhoneOff, video: Video, videoOff: VideoOff, micOff: MicOff, screen: Screen, expand: Expand, shrink: Shrink, arrowIn: ArrowIn, arrowOut: ArrowOut, grip: Grip, hash: Hash, lock: Lock, paperclip: Paperclip, smile: Smile, at: At, reply: Reply, edit: Edit, back: Back, search: Search, spark: Spark, bell: Bell, home: Home, chat: Chat, tempChat: TempChat, grid: Grid, check: Check, card: Card, calendar: Calendar, building: Building, buildings: Buildings, briefcase: Briefcase, folder: Folder, download: Download, upload: Upload, copy: Copy, eye: Eye, play: Play, layers: Layers, chart: Chart, bank: Bank, receipt: Receipt, file: File, pulse: Pulse, alert: Alert, users: Users, chevron: Chevron, plus: Plus, filter: Filter, sliders: Sliders, logout: Logout, settings: Settings, help: Help, sun: Sun, moon: Moon, menu: Menu, more: More, close: Close, mic: Mic, stop: Stop, arrowUp: ArrowUp, tick: Tick, history: History, trash: Trash, globe: Globe, mail: Mail }
