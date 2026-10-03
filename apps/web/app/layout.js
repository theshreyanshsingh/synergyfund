import { Inter } from "next/font/google"
import { Providers } from "../components/shell/Providers"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font" })

export const metadata = {
  title: "SynergiFund",
  description: "Private real estate investment operations",
}

export const viewport = {
  width: "device-width",
  initialScale: 1,
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
