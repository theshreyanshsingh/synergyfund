"use client"

import { Suspense } from "react"
import { ChatApp } from "../../../components/chat/ChatApp"
import { PageSpinner } from "../../../components/ui/Spinner"

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="chat-page"><PageSpinner label="Loading chat" /></div>}>
      <ChatApp />
    </Suspense>
  )
}
