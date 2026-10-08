import { Inter } from "next/font/google"
import { Providers } from "../components/shell/Providers"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font" })

export const metadata = {
  title: "SynergiFund",
  description: "Private real estate investment operations",
  applicationName: "SynergiFund",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "SynergiFund", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
}

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#111111",
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('synergifund-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}" }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
