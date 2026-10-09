"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toMarkdown } from "./chatFormat"

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
