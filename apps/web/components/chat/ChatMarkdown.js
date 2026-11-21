"use client"

import Link from "next/link"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toMarkdown } from "./chatFormat"

// The page of this app a link points to ("/properties/12?tab=draws"), or "" for anywhere else. Files the server sends
// (/api/…) are not pages and keep opening on their own.
function appPage(href) {
  if (typeof window === "undefined") return ""
  try {
    const url = new URL(href, window.location.origin)
    if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return ""
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return ""
  }
}

function keepUrl(url) {
  if (/^mention:/.test(url)) return url
  if (/^(https?:|mailto:|tel:|\/)/i.test(url)) return url
  return ""
}

export function ChatText({ text, people, me }) {
  return (
    <div className="chat-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={keepUrl}
        components={{
          a({ href = "", children }) {
            if (href.startsWith("mention:")) {
              const id = href.slice(8)
              const mine = id === me || id === "channel"
              return <span className={mine ? "chat-mention is-me" : "chat-mention"}>{children}</span>
            }
            // A link to a page of the app (pasted whole or as a path) opens here: a new window on a phone would leave
            // the app and end a call. Others open outside.
            const page = appPage(href)
            if (page) return <Link href={page}>{children}</Link>
            return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
          },
          img({ alt }) {
            return <span>{alt}</span>
          },
          h1: "strong",
          h2: "strong",
          h3: "strong",
          h4: "strong",
          h5: "strong",
          h6: "strong",
        }}
      >
        {toMarkdown(text, people)}
      </ReactMarkdown>
    </div>
  )
}
