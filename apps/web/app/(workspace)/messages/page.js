"use client"

import { Suspense } from "react"
import { ChatApp } from "../../../components/chat/ChatApp"
import { PageSpinner } from "../../../components/ui/Spinner"

// Direct messages have their own page; channels and property rooms are on /chat.
export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="chat-page"><PageSpinner label="Loading messages" /></div>}>
      <ChatApp mode="direct" />
    </Suspense>
  )
}
